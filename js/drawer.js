// «Πρόσφατα & Αγαπημένα» στο κάτω μέρος, με το ⋯ για επιλογές σε κάθε μέρος.

import { $, distTo } from "./util.js";
import { settings, saveSettings, places } from "./store.js";
import { state } from "./state.js";
import { placeRow, openActions, toast, onModeChange } from "./ui.js";
import { shortDist } from "./format.js";
import { previewDestination } from "./preview.js";
import { t } from "./i18n.js";

export function renderDrawer() {
  const open = settings.drawerOpen;
  $("drawer").classList.toggle("open", open);
  $("drawer-body").hidden = !open;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === settings.drawerTab));
  if (!open) return;

  const list = settings.drawerTab;
  const items = list === "history" ? places.history() : places.favorites();
  const ul = $("saved-list");
  ul.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = list === "history" ? t("drawer.noHistory") : t("drawer.noFav");
    ul.appendChild(li);
    return;
  }
  for (const p of items) {
    const li = placeRow(places.isFavorite(p) ? "★" : "🕘", p.name, p.sub, state.pos ? shortDist(distTo(state.pos, p)) : "");
    const more = document.createElement("button");
    more.className = "more";
    more.setAttribute("aria-label", t("aria.more"));
    more.textContent = "⋯";
    more.onclick = (e) => {
      e.stopPropagation();
      options(list, p);
    };
    li.appendChild(more);
    li.onclick = () => previewDestination(p);
    ul.appendChild(li);
  }
}

function options(list, p) {
  const fav = places.isFavorite(p);
  const buttons = [
    { label: t("act.routes"), fn: () => previewDestination(p) },
    {
      label: fav ? t("act.favRemove") : t("act.favAdd"),
      fn: () => {
        toast(places.toggleFavorite(p) ? t("fav.added") : t("fav.removed"));
        renderDrawer();
      },
    },
    {
      label: t("act.rename"),
      fn: () => {
        const name = prompt(t("act.renamePrompt"), p.name)?.trim();
        if (name) {
          places.rename(p.id, name);
          renderDrawer();
        }
      },
    },
    {
      label: list === "history" ? t("act.delHistory") : t("act.delFav"),
      danger: true,
      fn: () => {
        places.remove(list, p.id);
        renderDrawer();
      },
    },
  ];
  if (list === "history") {
    buttons.push({
      label: t("act.clearHistory"),
      danger: true,
      fn: () => {
        if (confirm(t("act.clearConfirm"))) {
          places.clearHistory();
          renderDrawer();
        }
      },
    });
  }
  openActions({ title: p.name }, buttons);
}

$("drawer-toggle").onclick = () => {
  settings.drawerOpen = !settings.drawerOpen;
  saveSettings();
  renderDrawer();
};
document.querySelectorAll(".tabs button").forEach((b) => {
  b.onclick = () => {
    settings.drawerTab = b.dataset.tab;
    saveSettings();
    renderDrawer();
  };
});
onModeChange((mode) => mode === "home" && renderDrawer());
