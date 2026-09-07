// .github/autoCloseExpired.js
//
// restore280 Institute: Automatic Closure of Expired Consent Requests
//
// Implements the automatic closure requirement of Bylaws Section 7.2. A pull
// request circulated for written consent that has not received the required
// majority by its response deadline closes automatically, without requiring
// action by any director or the Executive Director. This script runs on a
// schedule independent of any activity on a given pull request, since the
// rule it enforces must not depend on a person noticing that a deadline has
// passed.
//
// Deadline determination:
//   - Default: the PR's creation date plus ninety-one (91) calendar days,
//     the standard window under Section 7.2.
//   - Override: a line in the PR body reading "Response-Deadline: <ISO 8601
//     date or datetime>" sets an explicit deadline instead, for use with the
//     shorter urgent window under Section 7.2.
//
// Consent counting mirrors enforceApproval.js (recusal parsing, review and
// comment consent, majority calculation) so this script's determination of
// whether the requirement has been met always matches the posted
// consent-check status.

const { Octokit } = require("@octokit/rest");
const core = require("@actions/core");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const STANDARD_WINDOW_DAYS = 91;

function loadVoterConfig(cwd) {
  for (const name of ["voters.yml", "voters.yaml"]) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) {
      try {
        return yaml.load(fs.readFileSync(p, "utf8")) || {};
      } catch (e) {
        core.warning(`Could not parse ${name}: ${e.message}`);
      }
    }
  }
  return {};
}

// Parse an explicit deadline override from the PR body.
// Matches: "Response-Deadline: 2026-12-25" or a full ISO datetime.
function parseDeadlineOverride(body) {
  if (!body) return null;
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^response-deadline\s*:\s*(.+)$/i);
    if (match) {
      const d = new Date(match[1].trim());
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function computeDeadline(pr) {
  const override = parseDeadlineOverride(pr.body || "");
  if (override) return override;
  const deadline = new Date(pr.created_at);
  deadline.setDate(deadline.getDate() + STANDARD_WINDOW_DAYS);
  return deadline;
}

// Parse recusal declarations from PR body.
// Matches: "Recusal: @handle" or "Recused: handle"
function parseRecusals(body) {
  const recused = new Set();
  if (!body) return recused;
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^recus(?:al|ed)\s*:\s*@?(\S+)/i);
    if (match) recused.add(match[1].toLowerCase());
  }
  return recused;
}

async function fetchCommentSignals(octokit, owner, repo, pull_number, registeredVoters) {
  const signalByUser = new Map();
  let page = 1;
  while (true) {
    const { data: comments } = await octokit.issues.listComments({
      owner, repo, issue_number: pull_number, per_page: 100, page
    });
    for (const comment of comments) {
      const login = (comment.user && comment.user.login || "").toLowerCase();
      if (!registeredVoters.has(login)) continue;
      if (comment.user.type === "Bot") continue;
      const body = comment.body || "";
      const ts = new Date(comment.created_at || 0).getTime();
      const hasConsent = /(?:^|\s)\/consent(?:\s|$)/im.test(body);
      const hasDissent = /(?:^|\s)\/dissent(?:\s|$)/im.test(body);
      const hasRecuse = /(?:^|\s)\/recuse(?:\s|$)/im.test(body);
      if (!hasConsent && !hasDissent && !hasRecuse) continue;
      const prev = signalByUser.get(login);
      if (prev && ts < prev.ts) continue;
      const state = hasRecuse ? "RECUSED" : hasDissent ? "DISSENTED" : "APPROVED";
      signalByUser.set(login, { state, ts, method: "comment" });
    }
    if (comments.length < 100) break;
    page++;
  }
  return signalByUser;
}

function mergeConsents(reviewMap, commentMap) {
  const merged = new Map();
  const allVoters = new Set([...reviewMap.keys(), ...commentMap.keys()]);
  for (const v of allVoters) {
    const review = reviewMap.get(v);
    const comment = commentMap.get(v);
    if (review && comment) {
      merged.set(v, comment.ts >= review.ts ? comment : { ...review, method: "review" });
    } else if (review) {
      merged.set(v, { ...review, method: "review" });
    } else {
      merged.set(v, comment);
    }
  }
  return merged;
}

async function evaluateConsent(octokit, owner, repo, pr, cfg) {
  const prAuthorLC = (pr.user && pr.user.login || "").toLowerCase();
  const prBody = pr.body || "";

  const voters = Array.isArray(cfg.voters) ? cfg.voters : [];
  const votersLC = new Set(voters.map(v => v.toLowerCase()));

  // Recusal declared in the PR body is absolute and independent of comments.
  const bodyRecusedLC = parseRecusals(prBody);

  // Fetch comment signals from the full registered voter set so self-recusal
  // via /recuse can be detected before the effective voter set is finalized.
  const commentSignals = await fetchCommentSignals(octokit, owner, repo, pr.number, votersLC);

  const selfRecusedLC = new Set(
    [...commentSignals.entries()]
      .filter(([, sig]) => sig.state === "RECUSED")
      .map(([v]) => v)
  );

  const recusedLC = new Set([...bodyRecusedLC, ...selfRecusedLC]);

  const allowSelf = cfg.allow_self_approve === true;
  const excludeAuthor = typeof cfg.exclude_author === "boolean" ? cfg.exclude_author : !allowSelf;

  const effectiveVoters = new Set(
    [...votersLC].filter(v => {
      if (excludeAuthor && v === prAuthorLC) return false;
      if (recusedLC.has(v)) return false;
      return true;
    })
  );

  const requiredCount = Number.isInteger(cfg.required_approvals)
    ? cfg.required_approvals
    : Math.floor(effectiveVoters.size / 2) + 1;

  let reviews = [], page = 1;
  while (true) {
    const { data } = await octokit.pulls.listReviews({ owner, repo, pull_number: pr.number, per_page: 100, page });
    reviews = reviews.concat(data);
    if (data.length < 100) break;
    page++;
  }
  const reviewMap = new Map();
  for (const r of reviews) {
    const login = (r.user && r.user.login || "").toLowerCase();
    if (!effectiveVoters.has(login)) continue;
    const ts = new Date(r.submitted_at || 0).getTime();
    const prev = reviewMap.get(login);
    if (!prev || ts >= prev.ts) reviewMap.set(login, { state: r.state, ts });
  }

  const commentMap = new Map(
    [...commentSignals.entries()].filter(([v, sig]) => effectiveVoters.has(v) && sig.state !== "RECUSED")
  );
  const mergedConsents = mergeConsents(reviewMap, commentMap);

  const approved = [...effectiveVoters].filter(v => {
    const e = mergedConsents.get(v);
    return e && e.state === "APPROVED";
  }).length;

  return { approved, requiredCount, passed: approved >= requiredCount };
}

async function checkAndCloseIfExpired(octokit, owner, repo, pr, cfg) {
  const deadline = computeDeadline(pr);
  const now = new Date();
  if (now < deadline) return false;

  const { approved, requiredCount, passed } = await evaluateConsent(octokit, owner, repo, pr, cfg);
  if (passed) return false;

  await octokit.issues.createComment({
    owner, repo, issue_number: pr.number,
    body: [
      "## Response Deadline Expired",
      "",
      `This pull request's response deadline (${deadline.toISOString().slice(0, 10)}) has passed `
        + `with ${approved}/${requiredCount} required consent(s) received. Per Bylaws Section 7.2, `
        + "the action has failed and this pull request is closing automatically.",
      "",
      "A new pull request may be opened to recirculate this matter for consent at any time; "
        + "there is no requirement as to when a matter may be recirculated.",
      "",
      "*Closed automatically by the restore280 governance workflow.*"
    ].join("\n")
  });

  await octokit.pulls.update({ owner, repo, pull_number: pr.number, state: "closed" });
  console.log(`Closed PR #${pr.number}: response deadline expired without required consent.`);
  return true;
}

(async () => {
  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
    const cfg = loadVoterConfig(process.cwd());

    // TARGET_PR_NUMBER is set by the workflow for issue_comment-triggered
    // runs, so a new comment checks only the PR it was posted on rather
    // than rescanning every open PR. Unset (scheduled runs) scans all open
    // PRs, which remains the backstop for PRs that receive no further
    // comment activity after their deadline passes.
    const targetPR = (process.env.TARGET_PR_NUMBER || "").trim();

    if (targetPR) {
      const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: parseInt(targetPR, 10) });
      if (pr.state === "open") {
        await checkAndCloseIfExpired(octokit, owner, repo, pr, cfg);
      }
      return;
    }

    let openPRs = [], page = 1;
    while (true) {
      const { data } = await octokit.pulls.list({ owner, repo, state: "open", per_page: 100, page });
      openPRs = openPRs.concat(data);
      if (data.length < 100) break;
      page++;
    }

    for (const pr of openPRs) {
      await checkAndCloseIfExpired(octokit, owner, repo, pr, cfg);
    }
  } catch (error) {
    core.setFailed(`Error running automatic deadline closure: ${error.message}`);
  }
})();
