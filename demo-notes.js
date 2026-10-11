// Sample notes spread over the past year so the timeline, search and activity bar have
// something to show. Everything is tagged source='demo' and can be removed in one click.
// The content is generic developer life on purpose: nothing here comes from a real project.

const T = (n) => `BUG-${n}`;
const pick = (r, list) => list[r(list.length)];

const templates = [
  (r) => `Backup before refactor - cart total
// old version, keep until the new one is reviewed
function cartTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price * item.qty * (1 - (item.discount || 0) / 100);
  }
  return Math.round(total * 100) / 100;
}`,
  (r) => `${T(200 + r(300))}: dark mode toggle resets on reload
Steps:
1. Open settings, switch to dark
2. Refresh the page
3. Theme is light again
Suspect: we read localStorage before the settings provider mounts.`,
  (r) => `Tasks for today
- [x] review PR #${400 + r(200)}
- [ ] fix flaky test in checkout.spec.ts
- [ ] reply to design about the empty states
- [ ] update the release notes`,
  (r) => `SQL - find duplicate users
SELECT email, COUNT(*) AS cnt
FROM users
GROUP BY email
HAVING COUNT(*) > 1
ORDER BY cnt DESC;`,
  (r) => `Standup notes
Yesterday: finished the search endpoint, wrote tests
Today: pagination edge case (last page is empty)
Blockers: waiting for the staging database refresh`,
  (r) => `curl to test the orders API
curl -X POST https://api.example.com/v1/orders \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"cartId":"c_${1000 + r(8999)}","confirm":true}'`,
  (r) => `Git commands I always forget
git stash push -m "wip"          # stash with a name
git rebase -i HEAD~3             # squash last 3
git reflog                       # find lost commits
git cherry-pick <sha>
git branch --merged | grep -v main | xargs git branch -d`,
  (r) => `Meeting with product - onboarding flow
- skip the tour for returning users
- ask for notifications after the first saved item, not on launch
- need a decision on the free plan limit
Action: write up options by Friday`,
  (r) => `React snippet - debounced search
const [query, setQuery] = useState('');
useEffect(() => {
  const t = setTimeout(() => onSearch(query), 250);
  return () => clearTimeout(t);
}, [query]);`,
  (r) => `Ideas
- keyboard shortcut to copy the current line
- dark mode for the admin dashboard
- script that cleans old preview deployments every Friday`,
  (r) => `Error from prod log ${r(28) + 1}/${r(12) + 1}
TypeError: Cannot read properties of undefined (reading 'map')
    at ProductList (ProductList.jsx:42)
=> API returned {} instead of [] when the category is empty. Default to [].`,
  (r) => `Regex I needed
email:     ^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$
ticket:    \\bBUG-\\d{3,5}\\b
trailing spaces:  [ \\t]+$`,
  (r) => `${T(200 + r(300))}: images upload twice on slow networks
Root cause: the submit button is not disabled while the request is running.
Fix: disable it and show a spinner; ignore repeat clicks.
Tested on throttled 3G - OK.`,
  (r) => `Deployment checklist
1. run all tests on staging
2. check new environment variables are set
3. run database migrations
4. deploy
5. smoke test: sign up -> create item -> share link`,
  (r) => `Backup - config before change
{
  "retryCount": 3,
  "timeoutMs": 15000,
  "endpoint": "https://api.example.com/v2",
  "featureFlags": { "newSearch": false, "betaEditor": true }
}`,
  (r) => `Interview questions to ask
- how do you test code that calls an external API?
- walk me through debugging a slow page
- how would you design retries for a failing request?`,
  (r) => `Learning: JavaScript reduce
const byStatus = orders.reduce((acc, o) => {
  (acc[o.status] ||= []).push(o);
  return acc;
}, {});`,
  (r) => `Call with ${pick(r, ['the design team', 'QA', 'the mobile team', 'support'])}
They want a confirmation step before deleting a project.
Undo for 10 seconds might be enough instead of a dialog.
Need sample data for the demo next week.`,
  (r) => `PowerShell one-liners
Get-ChildItem -Recurse -Filter *.log | Remove-Item
Get-Process | Sort-Object CPU -Descending | Select -First 5
Test-NetConnection api.example.com -Port 443`,
  (r) => `Weekend todo
- renew car insurance
- buy new keyboard (low profile?)
- call home`,
  (r) => `Notes on async JavaScript
Promise.all: fails fast if any promise rejects
Promise.allSettled: waits for all, never rejects
Promise.race: first one to settle wins
await in a for loop runs one at a time - use Promise.all for parallel`,
  (r) => `Docker commands
docker ps -a
docker logs -f api
docker compose up -d --build
docker system prune -af   # careful: removes unused images`,
  (r) => `Perf: home page loads in ${3 + r(5)}.${r(9)}s
- 14 API calls on load, 9 fetch the same user profile
- cache the profile in memory
- lazy load the charts below the fold
target < 1.5s`,
  (r) => `Python snippet - read a CSV
import csv
with open("data.csv", newline="") as f:
    for row in csv.DictReader(f):
        print(row["name"], row["email"])`,
];

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Returns [{ body, created_at, edits: [timestamps], versions: [{ body, at }] }]
function buildDemoNotes(now = Date.now()) {
  const rand = mulberry32(20261010);
  const r = (n) => Math.floor(rand() * n);
  const DAY = 86400000;
  const notes = [];
  for (let back = 364; back >= 0; back--) {
    const d = new Date(now - back * DAY);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const recency = 1 - back / 365; // busier lately
    let p = (weekend ? 0.12 : 0.45) + recency * 0.3;
    if (back > 200 && back < 230) p = 0.04; // a quiet "vacation" month
    let count = 0;
    while (rand() < p && count < 6) { count++; p *= 0.55; }
    for (let i = 0; i < count; i++) {
      const t = new Date(d);
      t.setHours(9 + r(10), r(60), r(60), 0);
      if (t.getTime() > now) continue;
      const body = templates[r(templates.length)](r);
      const note = { body, created_at: t.getTime(), edits: [], versions: [] };
      // some notes get revisited on later days
      if (rand() < 0.25 && back > 3) {
        const later = t.getTime() + (1 + r(Math.min(back, 20))) * DAY;
        if (later < now) {
          note.versions.push({ body, at: later });
          note.body = body + `\n\nUpdate: ${['done, merged', 'QA passed', 'still open, waiting on reply', 'moved to next sprint'][r(4)]}`;
          note.edits.push(later);
        }
      }
      notes.push(note);
    }
  }
  return notes;
}

module.exports = { buildDemoNotes };
