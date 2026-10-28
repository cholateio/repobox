# RepoBox

[繁體中文](README.md) | **English**

You spot a good GitHub project while scrolling Threads or X, tap Share, and it lands in your own private repo. A few minutes later your own Claude subscription has read the project and written a plain-language overview, what it takes to use it, a technical summary and an architecture diagram.

![Reading page: the architecture diagram draws itself stroke by stroke; click it to enlarge and see how the components connect](docs/media/demo.gif)

- **Fast to save**: one tap from your phone's share menu or your computer's bookmarks bar, without opening another app.
- **Easy to follow**: "What it is" is written in plain language with one real example; "What it takes" lists the platforms, what you need to prepare and whether it costs money.
- **Architecture you can see**: every project gets an architecture diagram; click a node to see which components it connects to. The diagrams come from the [arch-blueprint](https://github.com/cholateio/arch-blueprint) skill, which you can also install in your own Claude Code, Codex or similar tools to draw any project.
- **Your data stays yours**: results are Markdown plus SVG, stored in your own private repo, and GitHub, Obsidian and VS Code can all read them directly.

<p>
  <img src="docs/media/home.png" alt="Collection page: a box for pasting links, a category index and cards with one-line descriptions" width="72%">
  <img src="docs/media/phone.png" alt="Collection page on a phone" width="24%">
</p>

The analysis is written in Traditional Chinese.

## How it works

```
share menu / bookmark ──► your collection page ──► private repo inbox/
                                                       │
                                   GitHub Actions + your Claude subscription
                                                       │
                       library/: overview, requirements, diagram ──► library on your page
```

There is no server, no database and no shared website. The web page is GitHub Pages on your own fork, and the analysis runs in your own GitHub Actions.

## Install

You need a GitHub account, a Claude subscription (only Claude is supported for now; ChatGPT and other subscriptions do not work yet), and a computer with Claude Code installed (to generate a token). Everything is done by clicking through the GitHub website; only step 2 needs one command in a terminal.

### 1. Set up the collection page

1. Fork this repo, then open the fork's **Actions** tab and enable it.
2. Under **Settings → Pages → Source** choose **GitHub Actions**, then run it once from **Actions → pages → Run workflow**.

The page will be at `https://<username>.github.io/repobox/`.

### 2. Create the library repo

1. Open [repobox-library-template](https://github.com/cholateio/repobox-library-template), click **Use this template → Create a new repository**, name it `repobox-library` and choose **Private**.
2. In a terminal with [Claude Code](https://claude.com/claude-code) installed, run `claude setup-token`; after you sign in it prints a token. In `repobox-library`, go to **Settings → Secrets and variables → Actions → New repository secret**, name it `CLAUDE_CODE_OAUTH_TOKEN` and paste the token.

### 3. Set up each phone or computer once, on the page from step 1

1. From your GitHub avatar, go to **Settings → Developer settings → Personal access token → Fine-grained tokens** and create a token: select only your private `repobox-library` and grant only **Contents: Read and write** and **Actions: Read and write** (the latter is for the reading page's 重新分析 (re-analyze) button).
2. Open the collection page's settings and enter `<username>/repobox-library` and this token.
3. On Android, add the page to your home screen and RepoBox appears in the share menu; on a computer, drag the bookmark button on the page to your bookmarks bar.

## Privacy & security

- The token is stored only in the browser on your own device and is sent only to `api.github.com`. The page loads no third-party code.
- Only public repos are analyzed. Claude is reading strangers' code, so that code is treated as untrusted data: Claude has no shell, can write to only one temporary folder, and its output is checked again by a separate job that does not run Claude before anything is written to your repo.
- The analysis workflow your library calls is pinned to a fixed version (a commit SHA), so later changes to this repo do not automatically reach your library. To change the workflow yourself, fork it and point `uses:` in `.github/workflows/repobox.yml` at your repo and SHA.
- Architecture diagrams pass an allowlist check once more before they are shown; a diagram that fails shows only a notice and is never executed.
- Consider giving the collection page a custom subdomain: other sites under the same `<username>.github.io` can read the token this page stores.

## License

[MIT](LICENSE). Architecture diagrams are drawn by [arch-blueprint](https://github.com/cholateio/arch-blueprint).
