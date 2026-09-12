#!/usr/bin/env bash
# Release-context decision shared by .github/workflows/publish.yml ("Resolve release target").
# Inputs come from the workflow environment; outputs go to GITHUB_OUTPUT. Kept as a
# standalone script so test/release-context.test.mjs executes the exact guard logic.
set -euo pipefail

# The workflow always provides GITHUB_STEP_SUMMARY; default it so the script can also
# run in local fixtures without changing CI behavior.
: "${GITHUB_STEP_SUMMARY:=/dev/null}"

git fetch --force origin +refs/heads/main:refs/remotes/origin/main
git fetch --force origin '+refs/tags/*:refs/tags/*'

if [ "${GITHUB_REPOSITORY}" != "tiangong-lca/mcp" ]; then
  echo "should_release=false" >> "$GITHUB_OUTPUT"
  echo "tag_created=false" >> "$GITHUB_OUTPUT"
  echo "::notice::Skipping release outside canonical repository: ${GITHUB_REPOSITORY}."
  exit 0
fi

read_package_version() {
  git show "${1}:package.json" | node -e "const fs = require('fs'); const pkg = JSON.parse(fs.readFileSync(0, 'utf8')); console.log(pkg.version);"
}

tag_created=false

if [ "${GITHUB_EVENT_NAME}" = "workflow_dispatch" ]; then
  tag_name="${REQUESTED_TAG_NAME}"
  if [ -z "${tag_name}" ] || [[ "${tag_name}" != v* ]]; then
    echo "::error::workflow_dispatch tag_name must be an existing v* tag."
    exit 1
  fi

  if ! release_head="$(git rev-list -n 1 "${tag_name}" 2>/dev/null)"; then
    echo "::error::Release tag ${tag_name} does not exist."
    exit 1
  fi

  package_version="$(read_package_version "${release_head}")"
  expected_tag="v${package_version}"
  if [ "${tag_name}" != "${expected_tag}" ]; then
    echo "::error::Release tag ${tag_name} does not match package.json version ${package_version} at ${release_head}."
    exit 1
  fi

  echo "::notice::Releasing existing ${tag_name} at ${release_head} with the current workflow definition."
elif [[ "${GITHUB_REF}" == refs/tags/v* ]]; then
  tag_name="${GITHUB_REF_NAME}"
  release_head="$(git rev-list -n 1 "${tag_name}")"
  package_version="$(read_package_version "${release_head}")"
  expected_tag="v${package_version}"
  if [ "${tag_name}" != "${expected_tag}" ]; then
    echo "::error::Release tag ${tag_name} does not match package.json version ${package_version} at ${release_head}."
    exit 1
  fi
else
  release_head="${GITHUB_SHA}"
  package_version="$(read_package_version "${release_head}")"
  tag_name="v${package_version}"
  version_changed=false

  if [ -n "${PUSH_BEFORE_SHA}" ] && [ "${PUSH_BEFORE_SHA}" != "0000000000000000000000000000000000000000" ]; then
    if git cat-file -e "${PUSH_BEFORE_SHA}:package.json" 2>/dev/null; then
      previous_version="$(read_package_version "${PUSH_BEFORE_SHA}")"
      if [ "${previous_version}" != "${package_version}" ]; then
        version_changed=true
      fi
    fi
  fi

  existing_tag_sha="$(git ls-remote --tags origin "refs/tags/${tag_name}" | awk '{print $1}')"
  if [ -n "${existing_tag_sha}" ]; then
    git fetch --force origin "refs/tags/${tag_name}:refs/tags/${tag_name}"
    existing_tag_commit="$(git rev-list -n 1 "${tag_name}")"
    if [ "${existing_tag_commit}" != "${release_head}" ]; then
      if [ "${version_changed}" = "false" ]; then
        echo "should_release=false" >> "$GITHUB_OUTPUT"
        echo "tag_created=false" >> "$GITHUB_OUTPUT"
        echo "tag_name=${tag_name}" >> "$GITHUB_OUTPUT"
        echo "release_head=${release_head}" >> "$GITHUB_OUTPUT"
        echo "::notice::${tag_name} already points to ${existing_tag_commit}; package.json version was unchanged in this main push, so this is not a new release."
        exit 0
      fi

      echo "::error::${tag_name} already points to ${existing_tag_commit}, not current main commit ${release_head}. Bump package.json before releasing another main commit."
      exit 1
    fi
    echo "::notice::${tag_name} already exists on current main commit ${release_head}; continuing release."
  else
    if [ "${version_changed}" != "true" ]; then
      echo "should_release=false" >> "$GITHUB_OUTPUT"
      echo "tag_created=false" >> "$GITHUB_OUTPUT"
      echo "tag_name=${tag_name}" >> "$GITHUB_OUTPUT"
      echo "release_head=${release_head}" >> "$GITHUB_OUTPUT"
      echo "::notice::package.json version did not change in this main push; skipping release."
      exit 0
    fi

    git tag "${tag_name}" "${release_head}"
    git push origin "refs/tags/${tag_name}"
    tag_created=true
    echo "::notice::Created ${tag_name} on ${release_head}."
  fi
fi

if ! git merge-base --is-ancestor "${release_head}" origin/main; then
  echo "should_release=false" >> "$GITHUB_OUTPUT"
  echo "tag_created=${tag_created}" >> "$GITHUB_OUTPUT"
  echo "tag_name=${tag_name}" >> "$GITHUB_OUTPUT"
  echo "release_head=${release_head}" >> "$GITHUB_OUTPUT"
  echo "::notice::Release target ${tag_name} points to ${release_head}, which is not on origin/main. Skipping registry publish."
  exit 0
fi

release_base="$(git rev-parse "${release_head}^")"

echo "release_base=${release_base}" >> "$GITHUB_OUTPUT"
echo "release_head=${release_head}" >> "$GITHUB_OUTPUT"
echo "should_release=true" >> "$GITHUB_OUTPUT"
echo "tag_created=${tag_created}" >> "$GITHUB_OUTPUT"
echo "tag_name=${tag_name}" >> "$GITHUB_OUTPUT"

{
  echo "### Release context"
  echo "- tag: \`${tag_name}\`"
  echo "- head: \`${release_head}\`"
  echo "- base: \`${release_base}\`"
  echo "- package version: \`${package_version}\`"
  echo "- tag created: \`${tag_created}\`"
} >> "$GITHUB_STEP_SUMMARY"
