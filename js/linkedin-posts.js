/* TalNXT LinkedIn posts shown on thought-leadership.html.

   To add a post:
     1. On LinkedIn, open the post on the TalNXT company page.
     2. Click "…" (top-right of the post) → "Embed this post" → copy the embed code.
     3. Paste it as a new line at the TOP of the list below (newest first), inside backticks:
          `<iframe src="https://www.linkedin.com/embed/feed/update/urn:li:share:7123456789012345678" ...></iframe>`,
        The post's own link also works:
          `https://www.linkedin.com/posts/talnxt_some-title-activity-7123456789012345678-AbCd`,
     4. Commit and push — the page updates on the next deploy.

   To remove a post, delete its line. */
window.TALNXT_LINKEDIN_POSTS = [
  `https://www.linkedin.com/feed/update/urn:li:activity:7526541053911339008`,
  `https://www.linkedin.com/feed/update/urn:li:activity:7526164333177929728`,
  `https://www.linkedin.com/feed/update/urn:li:activity:7525808294402260992`,
  `https://www.linkedin.com/feed/update/urn:li:activity:7525461758023782400`,
  `https://www.linkedin.com/feed/update/urn:li:activity:7525451830915690496`,
  `https://www.linkedin.com/feed/update/urn:li:activity:7523265554959368192`,
  `https://www.linkedin.com/feed/update/urn:li:activity:7522907867184795649`,
  `https://www.linkedin.com/feed/update/urn:li:activity:7520743091700510721`,
];
