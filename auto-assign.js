const core = require("@actions/core");
const github = require("@actions/github");
const shuffleArray = require("./shuffle");

const autoAssign = function () {
  return new Promise(async (resolve, reject) => {
    // this gets re-assigned later, so needs `let` not `const`
    let reviewerList = JSON.parse(core.getInput("reviewers"), {
      required: true,
    });

    let onlyDrafts = core.getInput("only-drafts");
    if (onlyDrafts === "false" || onlyDrafts === false) {
      onlyDrafts = false;
    } else {
      onlyDrafts = true;
    }

    let reviewerCount = parseInt(core.getInput("reviewer-count"));
    if (isNaN(reviewerCount)) {
      reviewerCount = 1;
    }

    const {
      number: pull_number,
      draft,
      requested_reviewers,
      base,
      user: { login: author },
    } = github.context.payload.pull_request;

    const owner = base.repo.owner.login,
      repo = base.repo.name,
      action = github.context.payload.action;

    const token = core.getInput("github-token", { required: true });
    const octokit = new github.GitHub(token);

    // first, if this PR has just been converted from a draft PR,
    // dismiss all reviews already submitted
    if (action === "ready_for_review" || action === "synchronize") {
      const { data: reviews } = await octokit.pulls.listReviews({
        owner,
        repo,
        pull_number,
      });

      let message = "dismissed because draft PR marked ready for review";
      if (action === "synchronize") {
        message = "dismissed because new commit(s) pushed";
      }

      let reReviewers = new Set();
      reviews.forEach(async ({ state, id, user: { login } }) => {
        // is there a reason I'm only dismissing APPROVED reviews...?
        if (state === "APPROVED") {
          reReviewers.add(login);
          await octokit.pulls.dismissReview({
            owner,
            repo,
            pull_number,
            review_id: id,
            message,
          });
        }
      });

      reReviewers = Array.from(reReviewers);
      if (reReviewers.length > 0) {
        console.log("re-requesting review from:", reReviewers);
        await octokit.pulls.createReviewRequest({
          owner,
          repo,
          pull_number,
          reviewers: reReviewers,
        });
      } else {
        console.log("no need to re-request any reviews");
      }
    } else {
      const shouldCheckReviewers = (onlyDrafts && draft) || !onlyDrafts;
      if (shouldCheckReviewers && requested_reviewers.length < reviewerCount) {
        console.log(
          `PR with fewer than desired reviewer count (${requested_reviewers.length}/${reviewerCount})`
        );

        const reviewersToAdd = reviewerCount - requested_reviewers.length;
        // remove the PR author from the potential reviewers
        reviewerList = reviewerList.filter((r) => r !== author);
        if (reviewersToAdd > reviewerList.length) {
          return core.setFailed(
            "You requested more reviewers than you provided in the approver list"
          );
        }

        let reviewers = [];
        while (reviewers.length < reviewersToAdd) {
          let candidate = shuffleArray(reviewerList)[0];
          if (reviewers.indexOf(candidate) === -1) {
            reviewers.push(candidate);
          }
        }

        if (reviewers.length > 0) {
          console.log("requesting reviews from:", reviewers);
          await octokit.pulls.createReviewRequest({
            owner,
            repo,
            reviewers,
            pull_number,
          });
        } else {
          console.log("no reviewers to request");
        }
      }
    }
  });
};

module.exports = autoAssign;
