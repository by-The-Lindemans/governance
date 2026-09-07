# restore280 Institute: Governance Repository

This repository is the official governance record of restore280 Institute, a Delaware nonprofit corporation. It contains the governing documents of the Corporation and implements the Board's written consent process through GitHub's pull request and review system.

---

## How This Repository Works

### Documents

The authoritative versions of all governing documents live here. The current document set includes:

| File | Description |
|------|-------------|
| `BYLAWS.md` | Bylaws of restore280 Institute |
| `policies/conflict-of-interest-policy.md` | Conflict of Interest Policy |
| `policies/document-retention-policy.md` | Document Retention and Destruction Policy |
| `policies/whistleblower-policy.md` | Whistleblower Protection Policy |
| `policies/editorial-and-compliance-policy.md` | Editorial and Compliance Policy |
| `policies/capital-deployment-and-partnership-policy.md` | Capital Deployment and Partnership Policy |
| `policies/external-funding-acceptance-policy.md` | External Funding Acceptance Policy |
| `policies/succession-and-continuity-plan.md` | Succession and Continuity Plan |
| `policies/strategic-prioritization-and-resource-allocation-policy.md` | Strategic Prioritization and Resource Allocation Policy |
| `policies/project-operations-and-reporting-policy.md` | Project Operations and Reporting Policy |
| `policies/communication-platform-administration-policy.md` | Communication Platform Administration Policy |
| `policies/human-labor-and-ai-use-policy.md` | Human Labor and Artificial Intelligence Use Policy |
| `records/` | Signed written consents and Board action records |

---

### Pull Requests as Written Consent

Article VII of the Bylaws establishes written consent as the default method for Board action. This repository implements that process as follows:

**Opening a PR = circulating a matter for consent.** The PR description serves as the written statement of the proposed action, including its type, deadline, and any recusal declarations. The PR author is typically the Executive Director.

**Approving a PR = consenting.** A director's GitHub review approval on a PR constitutes their written consent to the action described in that PR, for purposes of Article VII.1. Electronic signatures are explicitly accepted under Article VII.1 of the Bylaws.

**Merging a PR = the action taking effect.** A PR may only be merged after the consent requirement is met. Branch protection rules enforce this: the `consent-check` workflow must pass before merge is permitted.

**New commits reset consent.** Consent is given to a specific version of a matter (Bylaws Section 7.1). If new commits are pushed to an open PR, any existing GitHub review approvals or change-requests are dismissed automatically, and any existing `/consent` or `/dissent` comments are removed, after their full content is first reproduced in one consolidated comment so nothing is lost. Every director must reissue consent against the new content. A prior `/recuse`, or a PR-body `Recusal:` declaration, is not affected by new commits and remains in effect, since a conflict of interest does not depend on the specific text under consideration.

**Closing a PR without merging = action failed.** If the response deadline passes without majority consent, the PR closes automatically. The PR's comment history documents who consented and who did not, satisfying the Section 7.6 recordkeeping requirement.

---

### Consent Requirements

All Board actions require **majority consent**: more than half of all then-serving directors must approve the PR before it may merge, calculated as floor(n/2)+1 without regard to vacancies or non-responses. This implements the Article VII.4 vote threshold requirement.

The workflow reads the voter list from `.github/voters.yml` and posts a running status comment on each PR showing each director's current approval state and the current majority threshold.

---

### Response Deadlines

The PR description specifies the response deadline. Standard deadline is 91 calendar days from the date the PR is opened. Urgent matters may specify a shorter window of not less than 48 hours, with the reason stated in the PR description. There is no requirement as to when a PR must be opened for any given matter; the response window simply runs from whenever it is opened.

A director who does not respond by the deadline has not consented. If a majority of all then-serving directors have not consented by the deadline, the action fails and the PR closes automatically, without requiring action by the Executive Director or any director. A scheduled workflow checks daily for pull requests past their response deadline without the required consent and closes them, posting a comment noting the outcome; the same check also runs immediately whenever a new comment is posted on a PR, so a deadline that has already passed is caught right away rather than waiting for the next scheduled run. This satisfies the Section 7.2 requirement that non-response by deadline = action failed without depending on a person remembering to close the PR.

**Bylaw amendments use the same deadline rules as any other Board action.** Article XIII no longer imposes a separate advance-notice requirement; a PR amending `BYLAWS.md` may use either the standard 91-day deadline or the 48-hour urgent option, on the same terms as any other matter circulated for consent.

---

### Recusal

There are two ways to recuse a director from a PR:

**Body-declared recusal.** If a director has a conflict of interest requiring recusal under the Conflict of Interest Policy, the PR author adds a line to the PR description:

```
Recusal: @github-handle
```

This declaration must appear in the PR body (not in comments). It is absolute: once present, it can only be reversed by editing the PR body to remove it, not by that director commenting.

**Self-recusal.** A director may recuse themselves at any point by posting a comment containing `/recuse`. This follows the same most-recent-comment-wins rule as `/consent` and `/dissent`: a later `/consent` or `/dissent` from that same director reverses the self-recusal, and a later `/recuse` reverses a prior consent or dissent. If a single comment contains more than one command, `/recuse` takes precedence, then `/dissent`, then `/consent`.

Either method removes the director from the required voter list for that PR only.

---

### Requesting a Synchronous Meeting

Any director or the Executive Director may request a synchronous meeting for any agenda item under Article VII.3. To request one, leave a comment on the relevant PR stating the request. The PR is then held open while the synchronous meeting is scheduled. After the meeting, the outcome is recorded in a comment on the PR, and the PR is either merged (if approved) or closed (if not approved or withdrawn).

**Minimum meeting frequency.** Separately from meetings requested for a specific PR, Article VII.3 requires the Board to hold a minimum number of synchronous meetings each fiscal year, scaling with board size and revenue (one per year at the current three-director, pre-revenue stage; increasing at defined thresholds tied to Section 8.6). The Executive Director tracks which threshold currently applies and is responsible for scheduling these meetings; this obligation exists independent of any GitHub activity and is not tracked by the PR workflow.

---

### Updating the Voter List

When a director joins or leaves the Board, `voters.yml` must be updated to reflect the current Board composition. This update is itself a Board action and must go through the PR consent process alongside all documentation changes relating to a change in directorship. The new director's GitHub handle must be added to `voters.yml` by a PR meeting the same majority consent requirement as any other Board action under Article VII.4.

---

### Records

The `records/` directory contains signed copies of:

- The initial Written Consent to Adopt Bylaws and founding resolutions
- All subsequent written consents and Board action records
- Executed counterparts of significant agreements

These records are permanent under the Document Retention Policy. They are maintained here in addition to any physical or separately stored signed originals.

---

## Contact

**Governance questions:** admin@restore280.org  
**Executive Director and Treasurer:** Enik Nadir Linden  
**Board Chair:** Bridger Ryan Farnsworth
