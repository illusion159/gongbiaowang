/* 工标网 —— 轻量动效：滚动入场 + 数字滚动 + 导航浮起 */
(function () {
  'use strict';

  // 数字滚动（仅处理纯数字，如 63107）
  function animateCount(el) {
    var raw = el.textContent.trim().replace(/[,\s]/g, '');
    var target = parseInt(raw, 10);
    if (isNaN(target)) return;
    var duration = 1100;
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / duration);
      var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = Math.round(target * eased).toLocaleString('en-US');
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // 滚动入场：给卡片等块加 .reveal，进入视口后加 .in，动画结束后摘掉类以解除对 hover 位移的覆盖
  var revealTargets = document.querySelectorAll(
    '.card, .marquee, .result-table, .industry-item, .ccs-item, .capability-domain-item'
  );
  var stats = document.querySelectorAll('.stat b');

  function revealAndCount(el) {
    el.classList.add('in');
    var statEls = el.querySelectorAll('.stat b');
    for (var i = 0; i < statEls.length; i++) animateCount(statEls[i]);
    setTimeout(function () {
      el.classList.remove('reveal', 'in');
    }, 720);
  }

  if ('IntersectionObserver' in window && revealTargets.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          io.unobserve(en.target);
          revealAndCount(en.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    revealTargets.forEach(function (el) {
      el.classList.add('reveal');
      io.observe(el);
    });

    // 安全兜底：1.2 秒后强制显示所有卡片，避免 IntersectionObserver 未触发导致白屏
    setTimeout(function () {
      revealTargets.forEach(function (el) {
        el.classList.add('in');
        el.classList.remove('reveal');
      });
    }, 1200);
  } else {
    for (var i = 0; i < stats.length; i++) animateCount(stats[i]);
  }

  // 顶部导航滚动后浮起
  var nav = document.querySelector('.nav');
  if (nav) {
    var onScroll = function () {
      if (window.scrollY > 8) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // 搜索框：回车键触发搜索（提交所在表单）
  var searchInputs = document.querySelectorAll('.search-form input[type="text"], .advanced-form input[type="text"]');
  for (var si = 0; si < searchInputs.length; si++) {
    searchInputs[si].addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.form) this.form.submit();
      }
    });
  }

})();
