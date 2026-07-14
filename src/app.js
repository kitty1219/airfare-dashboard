const ROUTE_COLORS = { "上海→贵阳":"#2f6bff", "上海→长沙":"#0f9f8f", "杭州→贵阳":"#e69b25" };
const state = { route:"all", startDate:"", endDate:"", metric:"median", lead:"avg", trackerDate:"", data:null, loading:false };
const $ = (selector) => document.querySelector(selector);
const money = (value) => value == null ? "—" : `¥${Number(value).toLocaleString("zh-CN")}`;
const number = (value) => value == null ? "—" : Number(value).toLocaleString("zh-CN");
const shortDate = (value) => value ? value.slice(5).replace("-", "/") : "—";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[char]));

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindControls();
  loadDashboard();
});

function bindNavigation() {
  const links = [...document.querySelectorAll(".nav-link")];
  links.forEach((link) => link.addEventListener("click", () => {
    links.forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  }));
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a,b) => b.intersectionRatio-a.intersectionRatio)[0];
    if (!visible) return;
    links.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${visible.target.id}`));
  }, { rootMargin:"-25% 0px -60%", threshold:[0.05,0.3] });
  document.querySelectorAll(".dashboard-section").forEach((section) => observer.observe(section));
}

function bindControls() {
  [["#route-select","route"],["#metric-select","metric"],["#lead-select","lead"]].forEach(([selector,key]) => {
    $(selector).addEventListener("change", (event) => {
      state[key] = event.target.value;
      if (key === "route" || key === "lead") state.trackerDate = "";
      loadDashboard();
    });
  });
  [["#start-date","startDate"],["#end-date","endDate"]].forEach(([selector,key]) => {
    $(selector).addEventListener("change", (event) => {
      state[key] = event.target.value;
      if (state.startDate && state.endDate && state.startDate > state.endDate) {
        if (key === "startDate") state.endDate = state.startDate;
        else state.startDate = state.endDate;
      }
      state.trackerDate = "";
      loadDashboard();
    });
  });
  $("#refresh-button").addEventListener("click", loadDashboard);
  $("#flight-date-select").addEventListener("change", (event) => {
    state.trackerDate = event.target.value;
    loadTracker();
  });
  let timer;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => state.data && renderTrend(state.data), 150);
  });
}

async function fetchJson(path) {
  if (window.AirfareDataProvider) return window.AirfareDataProvider.query(path);
  throw new Error("公开聚合数据模块未加载");
}

async function loadDashboard() {
  if (state.loading) return;
  setLoading(true);
  try {
    const params = new URLSearchParams({ route:state.route, metric:state.metric, lead:state.lead });
    if (state.startDate) params.set("start_date", state.startDate);
    if (state.endDate) params.set("end_date", state.endDate);
    const data = await fetchJson(`/api/airfare/dashboard?${params}`);
    state.data = data;
    renderDashboard(data);
    setConnected(true);
    $("#error-banner").hidden = true;
  } catch (error) {
    console.error(error);
    setConnected(false);
    $("#error-banner").hidden = false;
    $("#error-banner").innerHTML = `无法读取监测数据：${escapeHtml(error.message)}。请重新运行“一键启动航空票价看板”。`;
  } finally { setLoading(false); }
}

function setLoading(loading) {
  state.loading = loading;
  $("#loading").hidden = !loading || Boolean(state.data);
  $("#dashboard").hidden = !state.data;
  ["#route-select","#start-date","#end-date","#metric-select","#lead-select","#refresh-button"].forEach((selector) => {
    $(selector).disabled = loading || !state.data;
  });
  $("#refresh-button").innerHTML = loading && state.data ? "<span>↻</span> 读取中" : "<span>↻</span> 刷新";
}

function setConnected(ok) {
  $("#source-status").textContent = ok ? "数据连接正常" : "数据连接中断";
  $("#source-detail").textContent = ok ? "脱敏公开聚合数据" : "数据读取失败";
  document.querySelector(".status-dot").style.background = ok ? "#56c9bb" : "#d95757";
}

function renderDashboard(data) {
  renderControls(data);
  renderHeader(data);
  renderKpis(data);
  renderDecision(data);
  renderRouteCards(data);
  renderTrend(data);
  renderDetail(data);
  renderMethod(data);
  renderCoverage(data);
  prepareTracker(data);
}

function optionsHtml(items, selected) {
  return items.map((item) => `<option value="${escapeHtml(item.value)}" ${String(item.value)===String(selected)?"selected":""}>${escapeHtml(item.label)}</option>`).join("");
}

function renderControls(data) {
  $("#route-select").innerHTML = optionsHtml(data.filters.routes || [], state.route);
  state.startDate = data.meta.startDate || "";
  state.endDate = data.meta.endDate || "";
  const available = data.meta.availableFlightDateRange || [];
  ["#start-date","#end-date"].forEach((selector) => {
    $(selector).min = available[0] || "";
    $(selector).max = available[1] || "";
  });
  $("#start-date").value = state.startDate;
  $("#end-date").value = state.endDate;
  $("#metric-select").innerHTML = optionsHtml(data.filters.metrics || [], state.metric);
  $("#lead-select").innerHTML = optionsHtml(data.filters.leads || [], state.lead);
}

function renderHeader(data) {
  $("#last-updated").textContent = data.meta.latestScrapeTime || "—";
  const range = data.meta.flightDateRange;
  $("#period-label").textContent = range ? `${range[0]} 至 ${range[1]} · ${data.meta.metricLabel} · ${data.meta.leadLabel}` : "暂无数据";
  $("#route-card-caption").textContent = `${data.meta.metricLabel} · ${data.meta.leadLabel}`;
}

function renderKpis(data) {
  const s = data.summary, m = data.meta;
  const all = state.route === "all";
  const cards = all ? [
    ["有效报价",number(m.sampleCount),"条","当前出行日范围内的原始报价",true],
    ["出行日期",number(s.flightDateCount),"天","横轴实际覆盖的出行日期",false],
    ["覆盖航线",number(data.routeSummaries.length),"条","当前筛选下有数据的航线",false],
    ["覆盖航班",number(m.flightCount),"个","按航班号去重",false],
    [`期间${m.metricLabel}均值`,money(s.periodMean),"","各航线、各出行日统计值的平均",false],
  ] : [
    [`最新出行日${m.metricLabel}`,money(s.latestValue),"",`最新有数据的出行日`,true],
    [`期间${m.metricLabel}均值`,money(s.periodMean),"","各出行日统计值的平均",false],
    ["期间最低",money(s.periodMin),"","出行日统计值中的最低值",false],
    ["期间最高",money(s.periodMax),"","出行日统计值中的最高值",false],
    ["有效出行日",number(s.flightDateCount),"天",`${number(m.sampleCount)}条原始报价`,false],
  ];
  $("#kpi-grid").innerHTML = cards.map(([label,value,unit,note,featured]) => `<article class="kpi-card ${featured?"featured":""}">
    <div class="kpi-label"><span>${label}</span></div><div class="kpi-value">${value}${unit?`<small>${unit}</small>`:""}</div><div class="kpi-note">${note}</div></article>`).join("");
}

function renderDecision(data) {
  const routes = data.routeSummaries || [], meta = data.meta;
  if (!routes.length) { $("#decision-text").textContent = "当前筛选条件下暂无可用报价。"; return; }
  if (state.route === "all") {
    const ranked = [...routes].sort((a,b) => b.periodMean-a.periodMean);
    $("#decision-text").textContent = `按“${meta.leadLabel}—${meta.metricLabel}”口径，${ranked[0].route}期间平均水平最高（${money(ranked[0].periodMean)}），${ranked[ranked.length-1].route}最低（${money(ranked[ranked.length-1].periodMean)}）。`;
  } else {
    const item = routes[0];
    $("#decision-text").textContent = `${item.route}最新有数据的出行日为${item.latestFlightDate}，${meta.metricLabel}为${money(item.latestValue)}；当前出行日期范围内波动区间为${money(item.periodMin)}—${money(item.periodMax)}。`;
  }
}

function renderRouteCards(data) {
  $("#route-grid").innerHTML = (data.routeSummaries || []).map((item) => {
    const color = ROUTE_COLORS[item.route] || "#2f6bff";
    return `<article class="route-card" style="--route-color:${color}">
      <div class="route-card-head"><h4>${escapeHtml(item.route)}</h4><span class="date-tag">更新至 ${item.latestFlightDate}</span></div>
      <div class="route-price"><strong>${money(item.latestValue)}</strong><span>最新出行日${data.meta.metricLabel}</span></div>
      <div class="route-stat-row"><span>期间均值 <b>${money(item.periodMean)}</b></span><span>范围 <b>${money(item.periodMin)}–${money(item.periodMax)}</b></span></div>
      <div class="route-meta"><span>${item.flightDateCount}个出行日</span><span>${number(item.sampleCount)}条报价</span></div>
    </article>`;
  }).join("");
}

function renderTrend(data) {
  $("#trend-title").textContent = `按出行日的${data.meta.metricLabel}变化`;
  $("#trend-subtitle").textContent = `${data.meta.leadLabel} · ${data.meta.priceBasis}`;
  const series = groupSeries(data.trend || []);
  $("#trend-legend").innerHTML = series.map((item) => `<span class="legend-item"><i class="legend-swatch" style="background:${item.color}"></i>${escapeHtml(item.name)}</span>`).join("");
  drawLineChart($("#trend-chart"), series, data.meta.metricLabel);
}

function groupSeries(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.route)) grouped.set(row.route, []);
    grouped.get(row.route).push({ x:row.flightDate, y:row.value, raw:row });
  });
  return [...grouped.entries()].map(([name,points]) => ({ name, color:ROUTE_COLORS[name]||"#2f6bff", points }));
}

function drawLineChart(container, series, metricLabel, axisLabel="出行日") {
  if (!series.length) { container.innerHTML = '<div class="empty-state">当前筛选条件下暂无数据</div>'; return; }
  const categories = [...new Set(series.flatMap((item) => item.points.map((point) => point.x)))].sort();
  const values = series.flatMap((item) => item.points.map((point) => point.y));
  const minRaw=Math.min(...values), maxRaw=Math.max(...values), step=maxRaw-minRaw>800?200:100;
  const minY=Math.max(0,Math.floor((minRaw-step*.35)/step)*step), maxY=Math.ceil((maxRaw+step*.35)/step)*step||step;
  const width=1000,height=350,pad={l:64,r:25,t:27,b:53};
  const x=(value)=>pad.l+(categories.length===1?(width-pad.l-pad.r)/2:categories.indexOf(value)/(categories.length-1)*(width-pad.l-pad.r));
  const y=(value)=>pad.t+(maxY-value)/(maxY-minY)*(height-pad.t-pad.b);
  const ticks=Array.from({length:5},(_,i)=>minY+(maxY-minY)*i/4), labelEvery=Math.max(1,Math.ceil(categories.length/8));
  let svg=`<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">`;
  ticks.forEach((tick)=>{ const py=y(tick); svg+=`<line class="grid-line" x1="${pad.l}" x2="${width-pad.r}" y1="${py}" y2="${py}"/><text class="axis-text" x="${pad.l-12}" y="${py+4}" text-anchor="end">¥${Math.round(tick)}</text>`; });
  categories.forEach((category,index)=>{ if(index%labelEvery!==0&&index!==categories.length-1)return; svg+=`<text class="axis-text" x="${x(category)}" y="${height-18}" text-anchor="middle">${shortDate(category)}</text>`; });
  series.forEach((item)=>{
    const sorted=[...item.points].sort((a,b)=>a.x.localeCompare(b.x));
    const d=sorted.map((point,index)=>`${index?"L":"M"}${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`).join(" ");
    svg+=`<path class="data-line" d="${d}" stroke="${item.color}"/>`;
    sorted.forEach((point)=>{ svg+=`<circle class="data-point" cx="${x(point.x)}" cy="${y(point.y)}" r="3.5" fill="${item.color}"><title>${item.name} · ${axisLabel} ${point.x} · ${metricLabel} ${money(point.y)} · ${point.raw.sampleCount}条报价</title></circle>`; });
  });
  container.innerHTML=svg+"</svg>";
}

function renderDetail(data) {
  const rows=[...(data.trend||[])].sort((a,b)=>b.flightDate.localeCompare(a.flightDate)||a.route.localeCompare(b.route,"zh-CN"));
  $("#metric-column").textContent=data.meta.metricLabel;
  $("#detail-count").textContent=`${rows.length}个数据点`;
  $("#detail-table").innerHTML=rows.map((row)=>`<tr><td><strong>${row.flightDate}</strong></td><td>${escapeHtml(row.route)}</td><td><strong>${money(row.value)}</strong></td><td>${number(row.sampleCount)}条</td><td>${state.lead==="avg"?`${row.leadDaysCovered}个提前期`:data.meta.leadLabel}</td></tr>`).join("");
}

function metricExplanation(metric) {
  return {
    min:"取同一出行日、同一航线、对应提前期报价中的最小值。",
    max:"取同一出行日、同一航线、对应提前期报价中的最大值。",
    mean:"计算同一出行日、同一航线、对应提前期全部报价的算术平均。",
    median:"取报价排序后的中间位置，降低少量极端价格的影响。",
    q25:"取报价分布的第25百分位，用于观察相对低价水平。",
    q75:"取报价分布的第75百分位，用于观察相对高价水平。",
  }[metric];
}

function renderMethod(data) {
  const leadText=state.lead==="avg"
    ? `先对每个提前期分别计算“${data.meta.metricLabel}”，再对各提前期结果取算术平均，避免某个提前期因报价数量较多而权重过高。`
    : `仅使用距出行日${state.lead}天时采集到的报价，计算“${data.meta.metricLabel}”。`;
  const cards=[
    ["PRICE","价格口径",data.meta.priceBasis+"。"],
    ["METRIC",`统计指标：${data.meta.metricLabel}`,metricExplanation(state.metric)],
    ["LEAD",`提前期：${data.meta.leadLabel}`,leadText],
    ["DATE","出行日期口径","主图横轴为航班实际出行日期；日期范围按当前提前期口径下有有效报价的出行日倒序选取。"],
  ];
  $("#method-grid").innerHTML=cards.map(([tag,title,text])=>`<article class="method-card"><span>${tag}</span><h3>${title}</h3><p>${text}</p></article>`).join("");
  const scrape=data.meta.scrapeDateRange, flight=data.meta.flightDateRange;
  $("#scrape-range").textContent=scrape?`${scrape[0]} 至 ${scrape[1]}`:"—";
  $("#flight-range").textContent=flight?`${flight[0]} 至 ${flight[1]}`:"—";
  $("#sample-count").textContent=`${number(data.meta.sampleCount)}条`;
  $("#basis-label").textContent=data.meta.priceBasis;
}

function renderCoverage(data) {
  const rows=data.batchCoverage||[], complete=rows.filter((item)=>item.complete).length;
  $("#coverage-summary").textContent=rows.length?`${complete}/${rows.length}个监测日完整 · 最新完整日 ${data.meta.latestCompleteScrapeDate||"—"}`:"所选日期范围内无监测批次";
  $("#coverage-strip").innerHTML=rows.length?rows.map((item,index)=>`<div class="coverage-cell ${item.complete?"complete":""} ${index===rows.length-1?"latest":""}" style="--height:${18+item.batches/7*34}px"><title>${item.date} · ${item.batches}/7批次${item.complete?" · 完整":" · 不完整"}</title></div>`).join(""):'<div class="coverage-empty">当前日期范围内没有实际监测日</div>';
}

function prepareTracker(data) {
  const select=$("#flight-date-select"), dates=data.filters.flightDates||[];
  if(!dates.length){
    select.disabled=true; select.innerHTML="<option>—</option>";
    $("#tracker-empty").hidden=false; $("#tracker-content").hidden=true;
    $("#tracker-help").textContent="当前日期范围内没有可追踪的出行日";
    return;
  }
  if(!state.trackerDate||!dates.includes(state.trackerDate)) state.trackerDate=dates[Math.floor((dates.length-1)/2)];
  select.innerHTML=dates.map((date)=>`<option value="${date}" ${date===state.trackerDate?"selected":""}>${date}</option>`).join("");
  select.disabled=false;
  $("#tracker-help").textContent=`${state.route==="all"?"全部航线":state.route} · 当前采用${data.meta.metricLabel}`;
  loadTracker();
}

async function loadTracker() {
  if(!state.trackerDate)return;
  const empty=$("#tracker-empty"),content=$("#tracker-content");
  empty.hidden=false; empty.textContent="正在读取出行日历史报价…"; content.hidden=true;
  try{
    const params=new URLSearchParams({route:state.route,flight_date:state.trackerDate,metric:state.metric});
    const data=await fetchJson(`/api/airfare/tracker?${params}`);
    if(!data.history?.length){empty.textContent="该出行日暂无可用历史报价。";return;}
    empty.hidden=true; content.hidden=false;
    const grouped=new Map();
    data.history.forEach((row)=>{if(!grouped.has(row.route))grouped.set(row.route,[]);grouped.get(row.route).push({x:row.scrapeDate,y:row.value,raw:row});});
    const series=[...grouped.entries()].map(([name,points])=>({name,color:ROUTE_COLORS[name]||"#2f6bff",points}));
    drawLineChart($("#tracker-chart"),series,data.meta.metricLabel,"监测日");
    $("#tracker-table").innerHTML=(data.flights||[]).map((item)=>`<tr><td>${escapeHtml(item.route)}</td><td><strong>${escapeHtml(item.flightNo)}</strong></td><td>${escapeHtml(item.airline)}</td><td>${escapeHtml(item.depTime)}</td><td>${money(item.min)}</td><td>${money(item.median)}</td><td>${money(item.max)}</td><td>${number(item.count)}</td></tr>`).join("");
  }catch(error){empty.hidden=false;empty.textContent=`读取失败：${error.message}`;}
}
