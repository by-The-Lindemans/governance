// .github/enforceApproval.js

const { Octokit } = require("@octokit/rest");
const core = require("@actions/core");

(async () => {
  try {
    // Initialize Octokit with the GitHub token
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    // Get repository details from environment variables
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    const pull_number = parseInt(process.env.GITHUB_REF.split('/').pop(), 10);

    // Fetch organization members
    const org = owner; // Assuming the owner is the organization
    let members = [];
    let page = 1;
    const per_page = 100;
    while (true) {
      const { data } = await octokit.orgs.listMembers({
        org,
        per_page,
        page,
      });
      members = members.concat(data);
      if (data.length < per_page) break;
      page++;
    }

    const totalMembers = members.length;
    const requiredApprovals = Math.ceil(totalMembers / 2);

    // Fetch pull request reviews
    let reviews = [];
    page = 1;
    while (true) {
      const { data } = await octokit.pulls.listReviews({
        owner,
        repo,
        pull_number,
        per_page,
        page,
      });
      reviews = reviews.concat(data);
      if (data.length < per_page) break;
      page++;
    }

    // Filter for 'APPROVED' reviews and ensure uniqueness by user
    const approvedUsers = new Set();
    reviews.forEach(review => {
      if (review.state === 'APPROVED') {
        approvedUsers.add(review.user.login);
      }
    });

    const approvalCount = approvedUsers.size;

    console.log(`Total Organization Members: ${totalMembers}`);
    console.log(`Required Approvals: ${requiredApprovals}`);
    console.log(`Current Approvals: ${approvalCount}`);

    if (approvalCount < requiredApprovals) {
      core.setFailed(`Pull request requires at least ${requiredApprovals} approvals, but only ${approvalCount} were provided.`);
    } else {
      console.log("Approval requirement met.");
    }
  } catch (error) {
    core.setFailed(`Error enforcing approval requirements: ${error.message}`);
  }
})();
