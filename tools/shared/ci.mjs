/**
 * Variables CI services set: `CI` (GitHub Actions, GitLab, Buildkite, CircleCI, Travis…) and the
 * service's own, which some set without `CI` (Azure Pipelines `TF_BUILD`, Jenkins `JENKINS_URL`).
 */
const CI_VARIABLES = ['CI', 'GITHUB_ACTIONS', 'BUILDKITE', 'JENKINS_URL', 'GITLAB_CI', 'TF_BUILD'];

/** Whether this run is on CI. An empty value or `false` (`CI=false` to opt out) is not CI. */
export function isCi(env = process.env) {
	return CI_VARIABLES.some((name) => {
		const value = env[name];
		return value !== undefined && value !== '' && value.toLowerCase() !== 'false';
	});
}

/**
 * The reason a gate test is skipped locally; on CI the same reason is a failure, because a gate
 * that silently skips is no gate (E22).
 */
export function skipOutsideCi(reason, env = process.env) {
	if (isCi(env)) throw new Error(`CI cannot skip: ${reason}`);
	return reason;
}
