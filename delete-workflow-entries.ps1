# Set your repository
$repo = "zekt-dev-org/zekt-action"

Write-Host "Deleting all workflow runs..." -ForegroundColor Cyan

# Get all workflow run IDs and delete them
$runIds = gh run list --repo $repo --limit 1000 --json databaseId --jq ".[].databaseId"
foreach ($runId in $runIds) {
    if ($runId) {
        Write-Host "Deleting run: $runId"
        gh run delete $runId --repo $repo
    }
}

Write-Host "`nDeleting all artifacts..." -ForegroundColor Cyan

# Get all artifact IDs and delete them
$artifactIds = gh api "repos/$repo/actions/artifacts" --paginate --jq ".artifacts[].id"
foreach ($artifactId in $artifactIds) {
    if ($artifactId) {
        Write-Host "Deleting artifact: $artifactId"
        gh api -X DELETE "repos/$repo/actions/artifacts/$artifactId"
    }
}

Write-Host "`nDone!" -ForegroundColor Green