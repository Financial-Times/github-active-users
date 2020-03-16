<!--
    Written in the format prescribed by https://github.com/Financial-Times/runbook.md.
    Any future edits should abide by this format.
-->

# Github Active Users Reporter

Allow audit Financial-Times github organisation users for when they recently contributed by logging usage splunk. Intended to be used for cost saving of github seats.

## Primary URL

<https://financialtimes.splunkcloud.com/en-GB/app/search/github_active_users__financialtimes?form.team=*&form.serviceTier=*&form.lastbuilddays=10000&form.time-picker.earliest=-7d%40h&form.time-picker.latest=now>

## Service Tier

Unsupported

## Lifecycle Stage

Deprecated

## Host Platform

AWS Lambda

## Delivered By

[reliability-engineering](https://biz-ops.in.ft.com/Team/reliability-engineering)

## Supported By

[reliability-engineering](https://biz-ops.in.ft.com/Team/reliability-engineering)

## First Line Troubleshooting

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

## Second Line Troubleshooting

Nothing further to add.

## Bespoke Monitoring

No bespoke monitoring.

## More Information

Currently the runtime for this script is fairly slow due to batching in sizes of 10 users. Increasing the number of users per Github API graphQL request results in 502 errors which are not due to rate limit violations.

As well as the afformentioned 502 errors when increasing batch size, occasionally 403s are encountered due to github rate limiting. There is already internal logic to retry as long as the `Retry-After` header is within a threshold of 70 seconds, and requests are throttled to only allow 1 per second but this still seems to trigger something on occasion.

## Contains Personal Data

False

## Contains Sensitive Data

False

## Architecture

An AWS Lambda function which runs every hour.

Each run talks to the Github GraphQL API, and reads the [Financial-Times/people](https://github.com/Financial-Times/people) repository, then writes logs to generate splunk reports.

These logs are logged to cloudwatch, and the log group is then forwarded to the aws-composer-module-auditing Splunk indexer lambdas which actually send the logs to Splunk.

## Dependencies

-   [github](https://biz-ops.in.ft.com/System/github)

## Failover Architecture Type

None

## Failover Process Type

None

## Failback Process Type

None

## Data Recovery Process Type

None

## Data Recovery Details

Not applicable.

## Release Process Type

FullyAutomated

## Rollback Process Type

PartiallyAutomated

## Release Details

Release:

-   Merge a commit to master
-   [CircleCI](https://circleci.com/gh/Financial-Times/workflows/github-active-users) will build and deploy the commit.

Rollback:

-   Open CircleCI for this project: [circleci:github-active-users](https://circleci.com/gh/Financial-Times/workflows/github-active-users)
-   Find the build of the commit which you wish to roll back to. The commit message is visible, and the `sha` of the commit is displayed to the right
-   Click on `Rerun`, under the build status for each workflow
-   Click `Rerun from beginning`

## Key Management Process Type

Manual

## Key Management Details

The systems secrets are stored in FT Vault in the folder [teams/reliability-engineering/github-active-users/prod](https://vault.in.ft.com:8080/ui/vault/secrets/secret/show/teams/reliability-engineering/github-active-users/prod).
