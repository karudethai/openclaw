# Pre-Commit Security & Publishing Checklist

Before you run `git push` or publish any changes to your public fork, go through this checklist to ensure you are not accidentally leaking credentials or sharing incomplete work.

## 🔐 1. Security & Credentials Check

**Goal: Ensure no API keys, tokens, or personal identifiers are hardcoded in your changes.**

* [ ] **Review your Git Diff:** 
  * Run `git diff origin/main` or `git diff HEAD` and scroll through *every line* you are adding. 
  * Look closely for strings starting with `sk-ant-` (Anthropic API keys), `ey` (JWT tokens), or OAuth credentials.
* [ ] **Check Configuration Files:** 
  * Ensure files like `.env`, `auth-profiles.json`, or `.secrets` are NOT included in your commit (they should be listed in your `.gitignore`).
* [ ] **Check Documentation Examples:** 
  * If you updated READMEs or `.md` files, ensure any example commands use placeholder keys (e.g., `YOUR_API_KEY_HERE`) and not your real credentials.
* [ ] **Test/Debug Code:** 
  * Did you temporarily hardcode a key to test something quickly? Make sure it's removed and replaced with an environment variable lookup (e.g., `process.env.API_KEY`).

## 🧹 2. Code Quality & Cleanliness

**Goal: Ensure your code is clean, formatted, and doesn't include temporary junk.**

* [ ] **No "Console.log" Spam:** Remove temporary debugging statements (`console.log`, `debugger`, print statements) unless they are intended for production logging.
* [ ] **Remove Dead Code:** Delete commented-out blocks of old code you no longer need.
* [ ] **Run the Linter/Formatter:** If the project uses ESLint, Prettier, or similar tools, run them to ensure your code matches the project's style guidelines. (e.g., `npm run lint` or `npm run format`).
* [ ] **Meaningful Commit Messages:** Ensure your commit messages clearly explain *what* you changed and *why*. (e.g., `feat: Add new mindmap view to UI` instead of `fix stuff`).

## 🧪 3. Functionality & Testing

**Goal: Prove that your changes work and don't break existing features.**

* [ ] **Does it build?** Run the build command (e.g., `npm run build`) and verify it completes without errors.
* [ ] **Do the tests pass?** Run the project's test suite (e.g., `npm test`). Do not push code with failing tests.
* [ ] **Manual Verification:** Did you open the application locally and verify your specific changes (like the new mindmap feature) work as expected in the UI?

## 🌳 4. Git Branching Rules

**Goal: Verify you are committing to the right place the right way.**

* [ ] **Am I on the right branch?** Verify you are on your feature branch (e.g., `mindmap`), NOT on `main`. (Run `git branch`).
* [ ] **Is my branch up to date?** Did you pull the latest changes from the original (`upstream`) `main` branch recently to avoid merge conflicts?

---

### Command Cheat Sheet

*   **See what you are about to commit (staged files):** `git diff --staged`
*   **See what branch you are on:** `git branch`
*   **See the status of your files:** `git status`
*   **Undo a commit locally (keep the files, just undo the commit):** `git reset --soft HEAD~1`
