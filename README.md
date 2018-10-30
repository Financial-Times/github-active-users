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

As well as the afformentioned 502 errors when increasing batch size, occasionally 403s are encountered due to github rate limiting. There is internal logic to retry as long as the `Retry-After` header is within a threshold of 70 seconds, however if this is persistent it may be prudent to make a change to throttle to 1 request per second to the github API.
