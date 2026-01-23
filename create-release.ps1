# Create Release Script for Zekt Action
# Usage: .\create-release.ps1 [patch|minor|major]

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('patch', 'minor', 'major')]
    [string]$BumpType = 'patch'
)

# Get the latest tag (filter out malformed tags like vv1.0.0)
$allTags = git tag --sort=-v:refname
$latestTag = $allTags | Where-Object { $_ -match '^v\d+\.\d+\.\d+$' } | Select-Object -First 1

if (-not $latestTag) {
    Write-Host "No tags found. Creating v2.0.1..."
    $newVersion = "v2.0.1"
} else {
    Write-Host "Latest tag: $latestTag"
    
    # Parse version (remove 'v' prefix)
    $version = $latestTag -replace '^v', ''
    $parts = $version -split '\.'
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]
    
    # Increment based on type
    switch ($BumpType) {
        'major' {
            $major++
            $minor = 0
            $patch = 0
        }
        'minor' {
            $minor++
            $patch = 0
        }
        'patch' {
            $patch++
        }
    }
    
    $newVersion = "v$major.$minor.$patch"
}

Write-Host "Creating new version: $newVersion" -ForegroundColor Green

# Confirm
$confirm = Read-Host "Continue? (y/n)"
if ($confirm -ne 'y') {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

# Create and push tag
Write-Host "Creating tag $newVersion..."
git tag $newVersion

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to create tag. It might already exist." -ForegroundColor Red
    exit 1
}

Write-Host "Pushing tag to origin..."
git push origin $newVersion

# Update major version pointer (e.g., v2)
$majorVersion = "v$major"
Write-Host "Updating $majorVersion pointer..."
git tag -f $majorVersion
git push origin $majorVersion --force

Write-Host "`n✅ Release $newVersion created successfully!" -ForegroundColor Green
Write-Host "Users can now reference:" -ForegroundColor Cyan
Write-Host "  - zekt-dev-org/zekt-action@$newVersion (specific version)"
Write-Host "  - zekt-dev-org/zekt-action@$majorVersion (latest v$major.x.x)"
Write-Host "  - zekt-dev-org/zekt-action@main (development)"
