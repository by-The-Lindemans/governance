// .github/enforceApproval.js
//
// restore280 Institute: Board Consent Enforcement
//
// Implements the board consent requirement of Article VII of the
// restore280 Bylaws. A majority of then-serving directors, per Section 7.4,
// must consent before a PR may merge.
//
// Two consent methods are accepted:
//
//   1. GitHub review approval: open the PR, click "Review changes", select
//      "Approve", submit. Available to all voters who are not the PR author.
//
//   2. Comment command: post a comment containing "/consent" anywhere in the
//      body. Available to all voters including the PR author. Post "/dissent"
//      to withdraw or oppose. Post "/recuse" to recuse yourself for this PR.
//      If more than one command appears in one comment, /recuse takes
//      precedence, then /dissent, then /consent. The most recent command per
//      voter across all comments wins, so a later /consent or /dissent
//      reverses an earlier self-recusal, and vice versa.
//
// The script explicitly posts a "consent-check" check run to the PR's head
// SHA via the GitHub Checks API, regardless of what event triggered the
// workflow. This ensures the PR status check always reflects the current
// consent state, including when triggered by an issue_comment event.
//
// Recusal: either add a line "Recusal: @handle" to the PR body (declared,
// e.g., by the PR author on behalf of an interested director; this form is
// absolute and can only be reversed by editing the PR body), or a voter may
// recuse themselves at any time by commenting "/recuse" (reversible by that
// same voter posting a later /consent or /dissent). Either method removes
// the voter from the required list for that PR.
//
// New commits pushed to an open PR reset consent: existing review approvals
// and change-requests are dismissed, and existing /consent and /dissent
// comments are removed after their full content is reproduced in one
// summary comment first. Recusal is unaffected and persists across new
// commits. See resetConsentOnNewCommits.

const { Octokit } = require("@octokit/rest");
const core = require("@actions/core");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

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

// Fetch /consent, /dissent, and /recuse commands from PR comments.
// Returns a Map of lowercase login -> { state, ts, method: "comment" }
// where state is one of "APPROVED", "DISSENTED", or "RECUSED".
// If more than one command appears in one comment, /recuse takes
// precedence, then /dissent, then /consent.
// The most recent command per voter across all comments wins, so a later
// /consent or /dissent reverses an earlier self-recusal, and vice versa.
//
// Takes the full registered voter set, not the post-recusal effective
// voter set, since self-recusal must be detected from these same comments
// before the effective voter set can be finalized.
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

// If this run was triggered by new commits being pushed to an already-open
// PR, any consent given before those commits was given to a version of the
// matter that no longer exists. Per Bylaws Section 7.1, such consent is
// invalidated and must be reissued. This function dismisses review
// approvals and change-requests submitted before the triggering push via
// GitHub's native dismissal mechanism (which preserves the review in
// history marked as dismissed, rather than deleting it, since GitHub does
// not permit deleting a submitted review), and removes /consent and
// /dissent comments posted before the triggering push after first posting
// one consolidated comment reproducing their full original content, so nothing
// is actually lost, only relocated out of the individual comments and into a
// single record. Consent given after the triggering push is left untouched.
// Recusal (/recuse comments, and PR-body "Recusal:"
// declarations, neither of which this function touches) remains in effect
// independent of any revision to the matter, since a conflict of interest
// does not depend on the specific text under consideration.
async function resetConsentOnNewCommits(octokit, owner, repo, pull_number, registeredVoters, cutoffMs) {
  let reviews = [], rPage = 1;
  while (true) {
    const { data } = await octokit.pulls.listReviews({ owner, repo, pull_number, per_page: 100, page: rPage });
    reviews = reviews.concat(data);
    if (data.length < 100) break;
    rPage++;
  }
  for (const r of reviews) {
    const login = (r.user && r.user.login || "").toLowerCase();
    if (!registeredVoters.has(login)) continue;
    const submittedMs = Date.parse(r.submitted_at || r.submittedAt || "");
    if (!Number.isFinite(submittedMs) || submittedMs > cutoffMs) continue;
    if (r.state !== "APPROVED" && r.state !== "CHANGES_REQUESTED") continue;
    try {
      await octokit.pulls.dismissReview({
        owner, repo, pull_number, review_id: r.id,
        message: "Dismissed automatically: new commits were pushed to this PR. Please review the updated content and reconsent."
      });
    } catch (err) {
      core.warning(`Could not dismiss review ${r.id}: ${err.message}`);
    }
  }

  let comments = [], cPage = 1;
  while (true) {
    const { data } = await octokit.issues.listComments({ owner, repo, issue_number: pull_number, per_page: 100, page: cPage });
    comments = comments.concat(data);
    if (data.length < 100) break;
    cPage++;
  }

  const toRemove = [];
  for (const c of comments) {
    const login = (c.user && c.user.login || "").toLowerCase();
    if (!registeredVoters.has(login)) continue;
    if (c.user.type === "Bot") continue;
    const createdMs = Date.parse(c.created_at || "");
    if (!Number.isFinite(createdMs) || createdMs > cutoffMs) continue;
    const body = c.body || "";
    const hasRecuse = /(?:^|\s)\/recuse(?:\s|$)/im.test(body);
    if (hasRecuse) continue;
    const hasConsent = /(?:^|\s)\/consent(?:\s|$)/im.test(body);
    const hasDissent = /(?:^|\s)\/dissent(?:\s|$)/im.test(body);
    if (!hasConsent && !hasDissent) continue;
    toRemove.push(c);
  }

  if (toRemove.length > 0) {
    const summaryLines = [
      "## Consent Reset: New Commits Pushed",
      "",
      "New commits were pushed to this PR. Per Bylaws Section 7.1, consent is given to a specific version of a matter; the consent and dissent signals below were given before this push and no longer apply. Each director listed must reissue consent against the current version. Original content is reproduced in full below and has been removed from its original comment to avoid confusion about which signals are currently active.",
      ""
    ];
    for (const c of toRemove) {
      const login = (c.user && c.user.login || "").toLowerCase();
      summaryLines.push(`**@${login}** (originally posted ${c.created_at}):`, "", "> " + (c.body || "").split("\n").join("\n> "), "");
    }
    summaryLines.push("*Posted automatically by the restore280 governance workflow.*");

    try {
      await octokit.issues.createComment({ owner, repo, issue_number: pull_number, body: summaryLines.join("\n") });
    } catch (err) {
      core.warning(`Could not post consent reset summary: ${err.message}`);
    }

    for (const c of toRemove) {
      try {
        await octokit.issues.deleteComment({ owner, repo, comment_id: c.id });
      } catch (err) {
        core.warning(`Could not delete comment ${c.id}: ${err.message}`);
      }
    }
  }
}

// Merge review approvals and comment consents. Most recent signal wins.
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

function buildStatusComment(effectiveVoters, mergedConsents, recusedLC, requiredCount, unanimousMode, prAuthorLC) {
  const rows = [...effectiveVoters].map(v => {
    const entry = mergedConsents.get(v);
    const isAuthor = v === prAuthorLC;
    const howTo = isAuthor
      ? "Comment `/consent` (GitHub blocks PR author self-review)"
      : "Approve via GitHub review, or comment `/consent`";
    if (!entry) return `| @${v} | ⏳ Pending | ${howTo} |`;
    if (entry.state === "APPROVED") {
      const via = entry.method === "comment" ? "/consent comment" : "GitHub review";
      return `| @${v} | ✅ Approved via ${via} | |`;
    }
    return `| @${v} | ❌ Dissented | Comment \`/consent\` to change |`;
  });

  const approvedCount = [...effectiveVoters].filter(v => {
    const e = mergedConsents.get(v);
    return e && e.state === "APPROVED";
  }).length;

  const lines = [
    "## Board Consent Status",
    "",
    `**Consent model:** ${unanimousMode
      ? "Unanimous: all directors must consent (Article VII.1)"
      : `${requiredCount} consent(s) required`}`,
    "",
    "| Director | Status | Action |",
    "|----------|--------|--------|",
    ...rows,
  ];

  if (recusedLC.size > 0) {
    lines.push("", `**Recused (conflict of interest):** ${[...recusedLC].map(h => `@${h}`).join(", ")}`);
  }

  lines.push(
    "",
    `**Progress:** ${approvedCount} of ${requiredCount} required consent(s) received.`,
    "",
    unanimousMode && approvedCount < requiredCount
      ? "⛔ Consent not yet complete. All directors must consent before this action may take effect."
      : approvedCount >= requiredCount
      ? "✅ Consent requirement met. This action may proceed."
      : "⛔ Consent not yet complete.",
    "",
    "**To consent:** Approve via GitHub review, or post a comment containing `/consent`.",
    "**To dissent:** Post a comment containing `/dissent`. If a comment contains more than one command, `/recuse` takes precedence, then `/dissent`, then `/consent`.",
    "**To reverse a dissent:** Delete or edit the dissent comment to remove `/dissent`, or post a new comment containing only `/consent`.",
    "**To recuse:** Add `Recusal: @yourhandle` to the PR description (only reversible by editing the description), or post a comment containing `/recuse` to recuse yourself (reversible by posting a later `/consent` or `/dissent`).",
    "",
    "*Updated automatically by the restore280 governance workflow.*"
  );

  return lines.join("\n");
}

// Post or update an explicit "consent-check" check run on the PR's head SHA.
// This is what the branch protection ruleset evaluates, and posting it
// explicitly ensures it updates correctly regardless of trigger event.
async function postCheckRun(octokit, owner, repo, headSha, conclusion, title, summary) {
  try {
    const { data: existing } = await octokit.checks.listForRef({
      owner, repo, ref: headSha, check_name: "consent-check", per_page: 10
    });
    const run = existing.check_runs[0];
    if (run) {
      await octokit.checks.update({
        owner, repo,
        check_run_id: run.id,
        status: "completed",
        conclusion,
        output: { title, summary }
      });
    } else {
      await octokit.checks.create({
        owner, repo,
        name: "consent-check",
        head_sha: headSha,
        status: "completed",
        conclusion,
        output: { title, summary }
      });
    }
  } catch (err) {
    core.warning(`Could not post check run: ${err.message}`);
  }
}

(async () => {
  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
    const payload = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));

    // Resolve PR number and metadata.
    // For issue_comment events, OVERRIDE_PR_NUMBER is set by the workflow
    // since the comment payload does not contain a pull_request object.
    let pull_number, prAuthorLC, prBody, headSha;

    const overridePR = process.env.OVERRIDE_PR_NUMBER;
    if (overridePR && overridePR.trim()) {
      pull_number = parseInt(overridePR.trim(), 10);
      const { data: prData } = await octokit.pulls.get({ owner, repo, pull_number });
      prAuthorLC = (prData.user && prData.user.login || "").toLowerCase();
      prBody = prData.body || "";
      headSha = prData.head.sha;
    } else {
      const pr = payload.pull_request;
      if (!pr) {
        core.setFailed("No pull request context found. This workflow must run on a pull_request, pull_request_review, or issue_comment event.");
        return;
      }
      pull_number = pr.number;
      prAuthorLC = (pr.user && pr.user.login || "").toLowerCase();
      prBody = pr.body || "";
      headSha = pr.head.sha;
    }

    // Load voter config from the checked-out branch (always the PR branch,
    // since the workflow checks out refs/pull/{n}/head for comment events).
    const cfg = loadVoterConfig(process.cwd());

    // Build voter list
    let voters = Array.isArray(cfg.voters) ? cfg.voters : [];
    const votersCSV = (process.env.VOTERS_CSV || "").trim();
    if (voters.length === 0 && votersCSV) {
      voters = votersCSV.split(",").map(s => s.trim()).filter(Boolean);
    }
    if (voters.length === 0) {
      let collaborators = [], page = 1;
      while (true) {
        const { data } = await octokit.repos.listCollaborators({ owner, repo, per_page: 100, page });
        collaborators = collaborators.concat(data);
        if (data.length < 100) break;
        page++;
      }
      voters = collaborators
        .filter(c => c.type !== "Bot" && c.permissions &&
          (c.permissions.push || c.permissions.maintain || c.permissions.admin))
        .map(c => c.login);
    }

    const votersLC = new Set(voters.map(v => v.toLowerCase()));

    // If new commits were just pushed to this PR, prior consent no longer
    // applies to the current content and must be reset before evaluating
    // consent below, per Bylaws Section 7.1.
    if (process.env.GITHUB_EVENT_NAME === "pull_request" && payload.action === "synchronize") {
      // Reset operations are bound to signals that already existed at this
      // event's pull_request.updated_at cutoff, so consent given afterward
      // survives a re-run of the same event.
      const cutoffMs = new Date(payload.pull_request && payload.pull_request.updated_at || 0).getTime();
      if (!Number.isFinite(cutoffMs) || cutoffMs <= 0) {
        throw new Error("Cannot safely reset consent: synchronize event has no valid pull_request.updated_at timestamp.");
      }
      await resetConsentOnNewCommits(octokit, owner, repo, pull_number, votersLC, cutoffMs);
    }

    // Recusal declared in the PR body is absolute: it applies regardless of
    // any comment activity and can only be reversed by editing the PR body.
    const bodyRecusedLC = parseRecusals(prBody);

    // Fetch comment signals from the full registered voter set (not yet
    // reduced to effective voters) so that self-recusal via /recuse can be
    // detected before the effective voter set is finalized.
    const commentSignals = await fetchCommentSignals(octokit, owner, repo, pull_number, votersLC);

    // Self-recusal is a voter's own choice and, unlike a body-declared
    // recusal, can be reversed by that same voter posting a later /consent
    // or /dissent comment. It is in effect only if RECUSED is that voter's
    // most recent signal.
    const selfRecusedLC = new Set(
      [...commentSignals.entries()]
        .filter(([, sig]) => sig.state === "RECUSED")
        .map(([v]) => v)
    );

    const recusedLC = new Set([...bodyRecusedLC, ...selfRecusedLC]);

    const allowSelf = cfg.allow_self_approve === true ||
      /^true$/i.test(process.env.ALLOW_SELF_APPROVE || "false");
    const excludeAuthor = typeof cfg.exclude_author === "boolean" ? cfg.exclude_author : !allowSelf;

    const effectiveVoters = new Set(
      [...votersLC].filter(v => {
        if (excludeAuthor && v === prAuthorLC) return false;
        if (recusedLC.has(v)) return false;
        return true;
      })
    );

    const unanimousMode = cfg.unanimous === true ||
      /^true$/i.test(process.env.UNANIMOUS || "false");

    let requiredCount;
    if (unanimousMode) {
      requiredCount = effectiveVoters.size;
    } else if (Number.isInteger(cfg.required_approvals)) {
      requiredCount = cfg.required_approvals;
    } else {
      // Strict majority: more than half of all then-serving directors,
      // per Section 7.4 of the Bylaws.
      requiredCount = Math.floor(effectiveVoters.size / 2) + 1;
    }

    if (effectiveVoters.size === 0 && !unanimousMode &&
        process.env.REQUIRED_APPROVALS == null && cfg.required_approvals == null) {
      console.log("No eligible voters after filters; skipping enforcement.");
      return;
    }

    // Fetch review approvals
    let reviews = [], page = 1;
    while (true) {
      const { data } = await octokit.pulls.listReviews({ owner, repo, pull_number, per_page: 100, page });
      reviews = reviews.concat(data);
      if (data.length < 100) break;
      page++;
    }

    const reviewMap = new Map();
    for (const r of reviews) {
      const login = (r.user && r.user.login || "").toLowerCase();
      if (!effectiveVoters.has(login)) continue;
      const ts = new Date(r.submitted_at || r.submittedAt || 0).getTime();
      const prev = reviewMap.get(login);
      if (!prev || ts >= prev.ts) {
        reviewMap.set(login, { state: r.state, ts });
      }
    }

    // Reuse the comment signals already fetched above (as part of computing
    // self-recusal), restricted to the final effective voter set and
    // excluding RECUSED entries, which are already excluded from
    // effectiveVoters and have no bearing on the consent/dissent tally.
    const commentMap = new Map(
      [...commentSignals.entries()].filter(([v, sig]) => effectiveVoters.has(v) && sig.state !== "RECUSED")
    );

    // Merge both consent sources
    const mergedConsents = mergeConsents(reviewMap, commentMap);

    const approvedUsers = [...effectiveVoters].filter(v => {
      const e = mergedConsents.get(v);
      return e && e.state === "APPROVED";
    });
    const pendingUsers = [...effectiveVoters].filter(v => !mergedConsents.has(v));
    const rejectedUsers = [...effectiveVoters].filter(v => {
      const e = mergedConsents.get(v);
      return e && e.state !== "APPROVED";
    });

    console.log(`Effective voters: ${[...effectiveVoters].join(", ")}`);
    console.log(`Unanimous mode: ${unanimousMode}`);
    console.log(`Required: ${requiredCount}`);
    console.log(`Approved: ${approvedUsers.join(", ") || "none"}`);
    console.log(`Pending: ${pendingUsers.join(", ") || "none"}`);
    console.log(`Dissented/dismissed: ${rejectedUsers.join(", ") || "none"}`);
    if (recusedLC.size > 0) console.log(`Recused: ${[...recusedLC].join(", ")} (body: ${[...bodyRecusedLC].join(", ") || "none"}; self: ${[...selfRecusedLC].join(", ") || "none"})`);

    // Determine outcome
    const approved = approvedUsers.length;
    const waiting = [...pendingUsers, ...rejectedUsers];
    const passed = approved >= requiredCount;

    // Post status comment on the PR
    try {
      const { data: allComments } = await octokit.issues.listComments({
        owner, repo, issue_number: pull_number
      });
      const botComment = allComments.find(c =>
        c.user && c.user.type === "Bot" &&
        c.body && c.body.includes("## Board Consent Status")
      );
      const commentBody = buildStatusComment(
        effectiveVoters, mergedConsents, recusedLC, requiredCount, unanimousMode, prAuthorLC
      );
      if (botComment) {
        await octokit.issues.updateComment({
          owner, repo, comment_id: botComment.id, body: commentBody
        });
      } else {
        await octokit.issues.createComment({
          owner, repo, issue_number: pull_number, body: commentBody
        });
      }
    } catch (commentErr) {
      core.warning(`Could not post status comment: ${commentErr.message}`);
    }

    // Post explicit check run to PR head SHA so the status check updates
    // correctly for all event types, including issue_comment.
    await postCheckRun(
      octokit, owner, repo, headSha,
      passed ? "success" : "failure",
      passed ? "Consent requirement met" : `Waiting on: ${waiting.join(", ")}`,
      passed
        ? `${approved}/${requiredCount} required consent(s) received. Action may proceed.`
        : `${approved}/${requiredCount} required consent(s) received.`
    );

    // Set job outcome
    if (!passed) {
      core.setFailed(
        unanimousMode
          ? `Unanimous consent required. ${approved}/${effectiveVoters.size} have consented. Waiting on: ${waiting.join(", ")}.`
          : `${requiredCount} consent(s) required; ${approved} received.`
      );
    } else {
      console.log("Consent requirement met. Action may proceed.");
    }

  } catch (error) {
    core.setFailed(`Error enforcing consent requirements: ${error.message}`);
  }
})();
