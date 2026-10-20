// SeqNexus site script, shared by every page of the site (index.html,
// features.html, the guide pages and 404.html).
// The initial dark class is set by an inline script in <head> of each page;
// this file handles the toggle, the themed screenshots, the sequence rules
// and the features page table of contents.
(function () {
  var KEY = 'seqnexus-landing-dark';
  var root = document.documentElement;

  function isDark() { return root.classList.contains('dark'); }

  // Screenshots can come in a light and a dark version. An <img> with
  // data-light and data-dark shows the one for the current theme; if the
  // dark file does not exist the light one is shown in both themes. Each
  // file has -720 and -1080 variants beside it (towebp.mjs writes them), so
  // the srcset is rebuilt from the file that is shown.
  function show(img, path) {
    img.setAttribute('src', path);
    if (img.hasAttribute('srcset')) {
      var base = path.replace(/\.webp$/, '');
      img.setAttribute('srcset', base + '-720.webp 720w, ' + base + '-1080.webp 1080w, ' + path + ' 1440w');
    }
  }
  function syncShots() {
    var imgs = document.querySelectorAll('img[data-light]');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var want = isDark() && img.getAttribute('data-dark') && !img.darkMissing
        ? img.getAttribute('data-dark')
        : img.getAttribute('data-light');
      if (img.getAttribute('src') !== want) show(img, want);
    }
  }

  // Called from the onerror attribute of every screenshot <img>.
  window.shotError = function (img) {
    var fig = img.closest('figure');
    if (img.getAttribute('src') === img.getAttribute('data-dark')) {
      img.darkMissing = true;
      show(img, img.getAttribute('data-light'));
      return;
    }
    if (fig) fig.classList.add('missing');
  };

  var btn = document.getElementById('theme-toggle');
  function syncBtn() {
    if (btn) btn.setAttribute('aria-pressed', String(isDark()));
  }

  if (btn) {
    btn.addEventListener('click', function () {
      var dark = root.classList.toggle('dark');
      try { localStorage.setItem(KEY, dark ? '1' : '0'); } catch (e) { /* storage blocked */ }
      syncBtn();
      syncShots();
    });
  }
  syncBtn();
  syncShots();

  // Sequence rules: a stretch of pDONR221 (GenBank JA808046.1) starting at
  // the position in data-from, one span per base so each takes its colour.
  var SEQ = 'ctttcctgcgttatcccctgattctgtggataaccgtattaccgcctttgagtgagctgataccgctcgccgcagccgaacgaccgagcgcagcgagtcagtgagcgaggaagcggaagagcgcccaatacgcaaaccgcctctccccgcgcgttggccgattcattaatgcagctggcacgacaggtttcccgactggaaagcgggcagtgagcgcaacgcaattaatacgcgtaccgctagccaggaagagtttgtagaaacgcaaaaaggccatccgtcaggatggccttctgcttagtttgatgcctggcagtttatggcgggcgtcctgcccgccaccctccgggccgttgcttcacaacgttcaaatccgctcccggcggatttgtcctactcaggagagcgttcaccgacaaacaacagataaaacgaaaggcccagtcttccgactgagcctttcgttttatttgatgcctggcagttccctactctcgcgttaacgctagcatggatgttttcccagtcacgacgttgtaaaacgacggccagtcttaagctcgggccccaaataatgattttattttgactgatagtgacctgttcgttgcaacacattgatgagcaatgcttttttataatgccaactttgtacaaaaaagctgaacgagaaacgtaaaatgatataaatatcaatatattaaattagattttgcataaaaaacagactacataatactgtaaaacacaacatatccagtcactatgaatcaactacttagatggtattagtgacctgtagtcgaccgacagccttccaaatgttcttcgggtgatgctgccaacttagtcgaccgacagccttccaaatgttcttctcaaacggaatcgtcgtatccagcctactcgctattgtcctcaatgccgtattaaatcataaaaagaaataagaaaaagaggtgcgagcctcttttttgtgtgacaaaataaaaacatctacctattcatatacgctagtgtcatagtcctgaaaatcatctgcatcaagaacaatttcacaactcttatacttttctcttacaagtcgttcggcttcatctggattttcagcctctatacttactaaacgtgataaagtttctgtaatttctactgtatcgacctgcagactggctgtgtataagggagcctgacatttatattccccagaacatcaggttaatggcgtttttgatgtcattttcgcggtggctgagatcagccacttcttccccgataacggagaccggcacactggccatatcggtggtcatcatgcgccagctttcatccccgatatgcaccaccgggtaaagttcacgggagactttatctgacagcagacgtgcactggccagggggatcaccatccgtcgcccgggcgtgtcaataatatcactctgtacatccacaaacagacgataacggctctctcttttataggtgtaaaccttaaactgcatttcaccagcccctgttctcgtcagcaaaagagccgttcatttcaataaaccgggcgacctcagccatcccttcctgattttccgctttccagcgttcggcacgcagacgacgggcttcattctgcatggttgtgcttaccagaccggagatattgacatcatatatgccttgagcaactgatagctgtcgctgtcaactgtcactgtaatacgctgcttcatagcatacctctttttgacatacttcgggtatacatatcagtatatattcttataccgcaaaaatcagcgcgcaaatacgcatactgttatctggcttttagtaagccggatccacgcggcgtttacgccccgccctgccactcatcgcagtactgttgtaattcattaagcattctgccgacatggaagccatcacagacggcatgatgaacctgaatcgccagcggcatcagcaccttgtcgccttgcgtataatatttgcccatggtgaaaacgggggcgaagaagttgtccatattggccacgtttaaatcaaaactggtgaaactcacccagggattggctgagacgaaaaacatattctcaataaaccctttagggaaataggccaggttttcaccgtaacacgccacatcttgcgaatatatgtgtagaaactgccggaaatcgtcgtggtattcactccagagcgatgaaaacgtttcagtttgctcatggaaaacggtgtaacaagggtgaacactatcccatatcaccagctcaccgtctttcattgccatacggaattccggatgagcattcatcaggcgggcaagaatgtgaataaaggccggataaaacttgtgcttatttttctttacggtctttaaaaaggccgtaatatccagctgaacggtctggttataggtacattgagcaactgactgaaatgcctcaaaatgttctttacgatgccattgggatatatcaacggtggtatatccagtgatttttttctccattttagcttccttagctcctgaaaatctcgataactcaaaaaatacgcccggtagtgatcttatttcattatggtgaaagttggaacctcttacgtgccgatcaacgtctcattttcgccaaaagttggcccagggcttcccggtatcaacagggacaccaggatttatttattctgcgaagtgatcttccgtcacaggtatttattcggcgcaaagtgcgtcgggtgatgctgccaacttagtcgactacaggtcactaataccatctaagtagttgattcatagtgactggatatgttgtgttttacagtattatgtagtctgttttttatgcaaaatctaatttaatatattgatatttatatcattttacgtttctcgttcagctttcttgtacaaagttggcattataagaaagcattgcttatcaatttgttgcaacgaacaggtcactatcagtcaaaataaaatcattatttgccatccagctgatatcccctatagtgagtcgtattacatggtcatagctgtttcctggcagctctggcccgtgtctcaaaatctctgatgttacattgcacaagataaaataatatcatcatgaacaataaaactgtctgcttacataaacagtaatacaaggggtgttatgagccatattcaacgggaaacgtcgaggccgcgattaaattccaacatggatgctgatttatatgggtataaatgggctcgcgataatgtcgggcaatcaggtgcgacaatctatcgcttgtatgggaagcccgatgcgccagagttgtttctgaaacatggcaaaggtagcgttgccaatgatgttacagatgagatggtcagactaaactggctgacggaatttatgcctcttccgaccatcaagcattttatccgtactcctgatgatgcatggttactcaccactgcgatccccggaaaaacagcattccaggtattagaagaatatcctgattcaggtgaaaatattgttgatgcgctggcagtgttcctgcgccggttgcattcgattcctgtttgtaattgtccttttaacagcgatcgcgtatttcgtctcgctcaggcgcaatcacgaatgaataacggtttggttgatgcgagtgattttgatgacgagcgtaatggctggcctgttgaacaagtctggaaagaaatgcataaacttttgccattctcaccggattcagtcgtcactcatggtgatttctcacttgataaccttatttttgacgaggggaaattaataggttgtattgatgttggacgagtcggaatcgcagaccgataccaggatcttgccatcctatggaactgcctcggtgagttttctccttcattacagaaacggctttttcaaaaatatggtattgataatcctgatatgaataaattgcagtttcatttgatgctcgatgagtttttctaatcagaattggttaattggttgtaacactggcagagcattacgctgacttgacgggacggcgcaagctcatgaccaaaatcccttaacgtgagttacgcgtcgttccactgagcgtcagaccccgtagaaaagatcaaaggatcttcttgagatcctttttttctgcgcgtaatctgctgcttgcaaacaaaaaaaccaccgctaccagcggtggtttgtttgccggatcaagagctaccaactctttttccgaaggtaactggcttcagcagagcgcagataccaaatactgttcttctagtgtagccgtagttaggccaccacttcaagaactctgtagcaccgcctacatacctcgctctgctaatcctgttaccagtggctgctgccagtggcgataagtcgtgtcttaccgggttggactcaagacgatagttaccggataaggcgcagcggtcgggctgaacggggggttcgtgcacacagcccagcttggagcgaacgacctacaccgaactgagatacctacagcgtgagctatgagaaagcgccacgcttcccgaagggagaaaggcggacaggtatccggtaagcggcagggtcggaacaggagagcgcacgagggagcttccagggggaaacgcctggtatctttatagtcctgtcgggtttcgccacctctgacttgagcgtcgatttttgtgatgctcgtcaggggggcggagcctatggaaaaacgccagcaacgcggcctttttacggttcctggccttttgctggccttttgctcacatgtt';

  var rules = document.querySelectorAll('.seq-rule');
  for (var r = 0; r < rules.length; r++) {
    var from = parseInt(rules[r].getAttribute('data-from') || '1', 10) - 1;
    var html = '';
    for (var p = from; p < from + 400 && p < SEQ.length; p++) {
      if ((p - from) % 50 === 0) {
        html += '<span class="pos">' + (p + 1) + '</span>';
      }
      var b = SEQ.charAt(p);
      html += '<span class="' + b + '">' + b.toUpperCase() + '</span>';
    }
    rules[r].innerHTML = html;
  }

  // Features page: highlight the section in view in the sticky contents.
  // The active one is the last section whose top has passed the masthead.
  var toc = document.querySelector(".toc");
  if (toc) {
    var links = toc.querySelectorAll("a[href^=\"#\"]");
    var byId = {};
    for (var l = 0; l < links.length; l++) byId[links[l].getAttribute("href").slice(1)] = links[l];
    var feats = document.querySelectorAll(".feat[id]");
    var current = null, ticking = false;
    function update() {
      ticking = false;
      var pick = feats[0];
      for (var f = 0; f < feats.length; f++) {
        if (feats[f].getBoundingClientRect().top <= 120) pick = feats[f];
      }
      var link = pick ? byId[pick.id] : null;
      if (link === current) return;
      if (current) current.classList.remove("active");
      current = link;
      if (current) current.classList.add("active");
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }
})();

// The strip plays once it is on screen. After it has finished and held for a
// while, the tool layers fade back and are redrawn over the sequence, which
// stays; every half minute or so. Replay restarts from the typing. Nothing
// loops while the tab is hidden or the strip is scrolled away.
(function () {
  var strips = document.querySelectorAll(".strip");
  var wrap = document.querySelector(".strip-wrap");
  if (!strips.length || !wrap) return;
  function each(fn) { for (var s = 0; s < strips.length; s++) fn(strips[s]); }
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DONE = 5600, SKIP = 1150, HOLD = 20000, FADE = 750;
  var timer = null, visible = false, started = false;

  function play(again) {
    clearTimeout(timer);
    each(function (strip) {
      strip.classList.remove("play", "out");
      strip.classList.toggle("again", !!again);
      void strip.getBoundingClientRect();
      strip.classList.add("play");
    });
    if (!reduce) timer = setTimeout(fade, (again ? DONE - SKIP : DONE) + HOLD);
  }
  function fade() {
    if (document.hidden || !visible) { timer = setTimeout(fade, 2000); return; }
    each(function (strip) { strip.classList.add("out"); });
    timer = setTimeout(function () { play(true); }, FADE);
  }

  var btn = document.getElementById("strip-replay");
  if (btn) btn.addEventListener("click", function () { play(false); });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      visible = es.some(function (e) { return e.isIntersecting; });
      if (visible && !started) { started = true; play(false); }
    }, { threshold: 0.1 }).observe(wrap);
  } else {
    visible = true; started = true; play(false);
  }
})();
