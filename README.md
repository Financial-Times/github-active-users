# Github Active Users

[![CircleCI](https://circleci.com/gh/Financial-Times/github-active-users.svg?style=shield&circle-token=74e8df5e1522549733fcb7e999e1869e12fb2c30)](https://circleci.com/gh/Financial-Times/github-active-users)

A node.js script to display a list of active users.

Currently the runtime for this script is fairly slow due to batching in sizes of 10 users. Iincreasing the number of users per Github API graphQL request results in 502 errors which are not due to rate limit violations.

## Usage

```shell
npx Financial-Times/github-active-users help
```

### Deployment

This application is also deployed as a serverless application, logging to splunk for reporting purposes.

## Output

Currently only outputs to a table format with the following headers:

-   `name`
-   `login`
-   `email`
-   `publicRepositoryContributionCount`
-   `privateRepositoryContributionCount`
-   `totalContributionCount`

The counts shown indicate the count of repositories for which there are any contribution (issues/PRs/commits/PR code reviews), not the total count of contributions for each repository.

## Troubleshooting

### Github retries

As well as the afformentioned 502 errors when increasing batch size, occasionally 403s are encountered due to github rate limiting. There is already internal logic to retry as long as the `Retry-After` header is within a threshold of 70 seconds, and requests are throttled to only allow 1 per second but this still seems to trigger something on occasion.

### Github access token

If the error log messages indicate a problem contacting the Github API, it may be necessary to rotate the Github API token in the Vault folder [teams/reliability-engineering/github-active-users/prod](https://vault.in.ft.com:8080/ui/vault/secrets/secret/show/teams/reliability-engineering/github-active-users/prod).

This key requires the scope:

```text
read:org
read:user
repo
```

### AWS credentials errors on deployment

If the deploy fails due to AWS authentication errors, it is necessary to rotate the AWS keys for [FTDeployUserFor_github-active-users](https://console.aws.amazon.com/iam/home?region=eu-west-1#/users/FTDeployUserFor_github-active-users) in the O&R Prod AWS account.
