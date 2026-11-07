  // ---- Guide tab (static reference content, no network) ----
  // Same structure as the French Guide: a table of contents box, then
  // one collapsible section per topic (the first one open).
  renderGuideTab(panel) {
    const sections = [];
    const section = (title, html) => sections.push({ title, html });

    section('Counting syllables & meter', `
      <p>English meter counts <strong>stressed feet</strong>, not raw syllables — unlike French,
      where counting syllables alone is usually enough. A line's meter name has two parts:
      the <em>foot type</em> (the stress pattern that repeats) and the <em>foot count</em>.</p>
      <table class="pn-guide-table">
        <tr><th>Foot</th><th>Pattern</th><th>Example</th></tr>
        <tr><td>Iambic</td><td>unstressed–STRESSED</td><td>a-<strong>WAY</strong></td></tr>
        <tr><td>Trochaic</td><td>STRESSED–unstressed</td><td><strong>TI</strong>-ger</td></tr>
        <tr><td>Anapestic</td><td>unstressed–unstressed–STRESSED</td><td>in the <strong>NIGHT</strong></td></tr>
        <tr><td>Dactylic</td><td>STRESSED–unstressed–unstressed</td><td><strong>MER</strong>-ri-ly</td></tr>
      </table>
      <table class="pn-guide-table">
        <tr><th>Feet</th><th>Name</th></tr>
        <tr><td>4</td><td>Tetrameter</td></tr>
        <tr><td>5</td><td>Pentameter (the default for sonnets, blank verse)</td></tr>
        <tr><td>6</td><td>Hexameter</td></tr>
      </table>
      <p>Common variations that are still considered "regular": a <strong>feminine ending</strong>
      (one extra unstressed syllable at the end of an iambic line), and occasional substitution
      of one foot (often a trochee for the first iamb of a line).</p>
    `);

    section('Rhyme: perfect vs. slant', `
      <p><strong>Perfect rhyme</strong> (a.k.a. full/exact/true rhyme): the stressed vowel and
      everything after it match exactly (<em>light</em> / <em>flight</em>), while the sound
      right before that vowel differs (otherwise it's just repetition, not rhyme).</p>
      <p><strong>Slant / near rhyme</strong> (a.k.a. half rhyme, off rhyme): the sounds are close
      but not identical. Two common kinds:</p>
      <ul>
        <li><strong>Consonance</strong> — matching final consonants, different vowel
        (<em>hand</em> / <em>end</em>)</li>
        <li><strong>Assonance</strong> — matching stressed vowel, different ending
        (<em>hand</em> / <em>cat</em>)</li>
      </ul>
      <p>The Rhymes tab's "strict / loose" setting controls whether slant rhymes are shown at all —
      they're always kept in a visually separate section from perfect rhymes, never mixed in.</p>
    `);

    section('Classic forms', `
      <ul>
        <li><strong>Shakespearean (English) sonnet</strong> — 14 lines, iambic pentameter,
        <code>ABAB CDCD EFEF GG</code> (three quatrains + a closing couplet).</li>
        <li><strong>Petrarchan (Italian) sonnet</strong> — 14 lines, iambic pentameter,
        <code>ABBA ABBA</code> octave + a sestet with a freer pattern, often
        <code>CDECDE</code> or <code>CDCDCD</code>.</li>
        <li><strong>Blank verse</strong> — unrhymed iambic pentameter (Shakespeare's plays,
        Milton's <em>Paradise Lost</em>).</li>
        <li><strong>Villanelle</strong> — 19 lines: five tercets + a closing quatrain, only two
        rhyme sounds throughout, with two refrain lines that keep reappearing on a fixed
        schedule.</li>
        <li><strong>Limerick</strong> — 5 lines, <code>AABBA</code>, anapestic, lines 1/2/5 longer
        (3 feet) than 3/4 (2 feet); almost always comic.</li>
      </ul>
    `);

    section('Elision & contractions', `
      <p>Older English poetry often marks a deliberately dropped syllable with an apostrophe
      to fit the meter: <em>o'er</em> (over), <em>'twas</em> (it was), <em>ne'er</em> (never),
      <em>walk'd</em> (walked, said as one syllable). The Syllables tab already expands the
      common <code>-'d</code> pattern automatically; if you hit one it doesn't catch, the
      per-word tooltip will show which source (CMUdict / override / heuristic) was used, which
      is usually the fastest way to spot the mismatch.</p>
    `);

    const toc = panel.createDiv({ cls: 'pn-guide-sommaire' });
    toc.createDiv({ cls: 'pn-guide-sommaire-titre', text: 'Contents' });
    const tocList = toc.createEl('ul');
    const detailsEls = [];
    sections.forEach((s, i) => {
      const link = tocList.createEl('li').createEl('a', { text: s.title, attr: { href: '#' } });
      link.addEventListener('click', (e) => {
        e.preventDefault();
        detailsEls[i].open = true;
        detailsEls[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    sections.forEach((s, i) => {
      const det = panel.createEl('details', { cls: 'pn-guide-section' });
      if (i === 0) det.setAttr('open', 'true');
      det.createEl('summary', { cls: 'pn-guide-titre', text: s.title });
      const body = det.createDiv({ cls: 'pn-guide-corps' });
      body.innerHTML = s.html;
      body.querySelectorAll('p').forEach((el) => el.classList.add('pn-guide-p'));
      body.querySelectorAll('ul, ol').forEach((el) => el.classList.add('pn-guide-liste'));
      detailsEls.push(det);
    });
  }
