const variants = {
  balanced: {
    kicker: "方案 A · 探索型",
    title: "今天想先做什么？",
    note: "<strong>适合：</strong>低龄学生首次使用，所有功能都能在一屏内看见。<span><strong>取舍：</strong>入口最多，主任务突出程度一般。</span>",
  },
  focus: {
    kicker: "方案 B · 任务型 · 推荐",
    title: "先把今天的学习资料交给管家",
    note: "<strong>适合：</strong>日常高频使用，第一任务明确，误触和选择成本最低。<span><strong>取舍：</strong>次要功能入口有所收敛。</span>",
  },
  path: {
    kicker: "方案 C · 引导型",
    title: "按学习步骤，一步一步完成",
    note: "<strong>适合：</strong>需要建立学习习惯的学生，流程更有秩序。<span><strong>取舍：</strong>自由探索感低于全功能宫格。</span>",
  },
};

const tabs = [...document.querySelectorAll(".variant-tab")];
const views = [...document.querySelectorAll(".demo-view")];
const kicker = document.querySelector("#variant-kicker");
const title = document.querySelector("#variant-title");
const note = document.querySelector("#variant-note");
const toast = document.querySelector(".action-toast");
const toastText = toast.querySelector("span");
let toastTimer;

function setVariant(name, updateUrl = true) {
  const next = variants[name] ? name : "balanced";
  tabs.forEach((tab) => {
    const active = tab.dataset.variant === next;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-pressed", String(active));
  });
  views.forEach((view) => {
    const active = view.dataset.view === next;
    view.hidden = !active;
    view.classList.toggle("is-active", active);
  });
  kicker.textContent = variants[next].kicker;
  title.textContent = variants[next].title;
  note.innerHTML = variants[next].note;
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    history.replaceState({}, "", url);
  }
}

function showToast(action) {
  toastText.textContent = `${action} · 当前为界面演示，未执行真实操作`;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1800);
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => setVariant(tab.dataset.variant));
  tab.addEventListener("keydown", (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const nextTab = tabs[(index + step + tabs.length) % tabs.length];
    nextTab.focus();
    setVariant(nextTab.dataset.variant);
  });
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => showToast(button.dataset.action));
});

const initialVariant = new URLSearchParams(window.location.search).get("variant") || "balanced";
setVariant(initialVariant, false);
