#!/usr/bin/env node
/**
 * 测试脚本：验证 aria_snapshot AI 模式下的 visible:occluded 场景
 *
 * 场景说明：
 * - 网页左侧有一个侧边栏，默认被主内容层遮挡（在后方）
 * - 点击「展开侧边栏」后，侧边栏置于前方，正常显示
 * - 预期：侧边栏未展开时为 visible:occluded，展开后为 visible
 *
 * 注意: 视口位置标记只在 AI 模式下启用，使用 _snapshotForAI() 或 locator.ariaSnapshot({ mode: 'ai' })
 */

const { chromium } = require('../packages/playwright-core');

async function testVisibleOccludedSidebar(page) {
  console.log('\n' + '='.repeat(70));
  console.log('测试: visible:occluded — 左侧侧边栏被主内容遮挡');
  console.log('='.repeat(70));

  // 布局说明：
  // - 侧边栏：position:fixed, left:0, width:200px, z-index:1
  // - 主内容遮罩：position:fixed 覆盖全屏, z-index:2，默认盖住侧边栏
  // - 展开时：侧边栏 z-index:10，显示到最前
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; }
        /* 侧边栏：左侧固定，默认在下层 */
        .sidebar {
          position: fixed;
          left: 0;
          top: 0;
          width: 200px;
          height: 100%;
          background: #87CEEB;
          z-index: 1;
          padding: 20px;
        }
        .sidebar.expanded { z-index: 10; }
        .sidebar h2 { margin: 0 0 16px 0; font-size: 16px; }
        .sidebar button { padding: 10px 16px; cursor: pointer; }
        /* 主内容层：覆盖全屏，盖住侧边栏 */
        .main-cover {
          position: fixed;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background: #f5f5f5;
          z-index: 2;
          padding: 20px;
          padding-left: 40px;
        }
        .main-cover h1 { margin: 0 0 16px 0; }
        .toggle-btn { padding: 10px 20px; cursor: pointer; font-size: 14px; }
      </style>
    </head>
    <body>
      <!-- 侧边栏：未展开时被 main-cover 遮挡 -->
      <aside class="sidebar" id="sidebar">
        <h2>侧边栏</h2>
        <button id="sidebar-btn">侧边栏内按钮</button>
        <a href="#sidebar-link" id="sidebar-link">侧边栏链接</a>
      </aside>
      <!-- 主内容遮罩 -->
      <main class="main-cover">
        <h1>主内容区域</h1>
        <button class="toggle-btn" id="toggle-sidebar">展开侧边栏</button>
        <p>侧边栏在左侧，被本层遮挡。点击「展开侧边栏」后侧边栏会显示到最前。</p>
      </main>
    </body>
    </html>
  `);

  // 绑定展开/收起逻辑
  await page.evaluate(() => {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('toggle-sidebar');
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('expanded');
      toggleBtn.textContent = sidebar.classList.contains('expanded') ? '收起侧边栏' : '展开侧边栏';
    });
  });

  await page.waitForTimeout(300);

  // ---------- 步骤 1：侧边栏未展开，应被标记为 visible:occluded ----------
  console.log('\n[1] 侧边栏未展开，获取 aria_snapshot...');
  const snapshotResult1 = await page._snapshotForAI();
  const snapshot1 = snapshotResult1.full;

  console.log('--- 未展开时 aria_snapshot 输出 ---');
  console.log(snapshot1);
  console.log('--- 输出结束 ---\n');

  const sidebarBtnOccluded = /侧边栏内按钮[^\n]*\[visible:occluded\]/.test(snapshot1);
  const sidebarLinkOccluded = /侧边栏链接[^\n]*\[visible:occluded\]/.test(snapshot1);
  const sidebarBtnVisibleWhenCollapsed = /侧边栏内按钮[^\n]*\[visible\]/.test(snapshot1) && !snapshot1.includes('visible:occluded');

  console.log('[2] 验证未展开时侧边栏元素为 visible:occluded...');
  console.log(`    侧边栏内按钮 为 [visible:occluded]: ${sidebarBtnOccluded ? '✅ 是' : '❌ 否'}`);
  console.log(`    侧边栏链接 为 [visible:occluded]: ${sidebarLinkOccluded ? '✅ 是' : '❌ 否'}`);
  console.log(`    侧边栏内按钮 未被错误标为 [visible]: ${!sidebarBtnVisibleWhenCollapsed ? '✅ 是' : '❌ 否'}`);

  // ---------- 步骤 3：点击展开侧边栏 ----------
  console.log('\n[3] 点击「展开侧边栏」...');
  await page.click('#toggle-sidebar');
  await page.waitForTimeout(300);

  const snapshotResult2 = await page._snapshotForAI();
  const snapshot2 = snapshotResult2.full;

  console.log('--- 展开后 aria_snapshot 输出 ---');
  console.log(snapshot2);
  console.log('--- 输出结束 ---\n');

  const sidebarBtnVisibleWhenExpanded = /侧边栏内按钮[^\n]*\[visible\]/.test(snapshot2);
  const sidebarLinkVisibleWhenExpanded = /侧边栏链接[^\n]*\[visible:occluded\]/.test(snapshot2);
  const sidebarStillOccludedWhenExpanded = /侧边栏内按钮[^\n]*\[visible:occluded\]/.test(snapshot2);

  console.log('[4] 验证展开后侧边栏元素为 visible...');
  console.log(`    侧边栏内按钮 为 [visible]: ${sidebarBtnVisibleWhenExpanded ? '✅ 是' : '❌ 否'}`);
  console.log(`    侧边栏链接 为 [visible:occluded]: ${sidebarLinkVisibleWhenExpanded ? '✅ 是' : '❌ 否'}`);
  console.log(`    展开后未错误标为 occluded: ${!sidebarStillOccludedWhenExpanded ? '✅ 是' : '❌ 否'}`);

  return {
    sidebarBtnOccluded,
    sidebarLinkOccluded,
    sidebarBtnVisibleWhenExpanded,
    sidebarLinkVisibleWhenExpanded,
    notVisibleWhenCollapsed: !sidebarBtnVisibleWhenCollapsed,
    notOccludedWhenExpanded: !sidebarStillOccludedWhenExpanded
  };
}

async function main() {
  console.log('='.repeat(70));
  console.log('Playwright aria_snapshot visible:occluded 场景测试 (AI 模式)');
  console.log('='.repeat(70));

  console.log('\n[启动] 启动 Chromium 浏览器...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();

  const results = await testVisibleOccludedSidebar(page);

  console.log('\n[关闭] 关闭浏览器...');
  await browser.close();

  // 汇总
  console.log('\n' + '='.repeat(70));
  console.log('测试结果汇总');
  console.log('='.repeat(70));
  console.log('\n📋 visible:occluded 侧边栏场景:');
  console.log(`   - 未展开时侧边栏内按钮为 [visible:occluded]: ${results.sidebarBtnOccluded ? '✅ 通过' : '❌ 失败'}`);
  console.log(`   - 未展开时侧边栏链接为 [visible:occluded]: ${results.sidebarLinkOccluded ? '✅ 通过' : '❌ 失败'}`);
  console.log(`   - 未展开时未错误标为 [visible]: ${results.notVisibleWhenCollapsed ? '✅ 通过' : '❌ 失败'}`);
  console.log(`   - 展开后侧边栏内按钮为 [visible]: ${results.sidebarBtnVisibleWhenExpanded ? '✅ 通过' : '❌ 失败'}`);
  console.log(`   - 展开后侧边栏链接为 [visible:occluded]: ${results.sidebarLinkVisibleWhenExpanded ? '✅ 通过' : '❌ 失败'}`);
  console.log(`   - 展开后未错误标为 [visible:occluded]: ${results.notOccludedWhenExpanded ? '✅ 通过' : '❌ 失败'}`);

  const allPassed =
    results.sidebarBtnOccluded &&
    results.sidebarLinkOccluded &&
    results.notVisibleWhenCollapsed &&
    results.sidebarBtnVisibleWhenExpanded &&
    results.sidebarLinkVisibleWhenExpanded &&
    results.notOccludedWhenExpanded;

  console.log('\n' + '='.repeat(70));
  if (allPassed) {
    console.log('✅ 所有 visible:occluded 测试通过！');
  } else {
    console.log('❌ 部分测试失败！');
  }
  console.log('='.repeat(70));

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
