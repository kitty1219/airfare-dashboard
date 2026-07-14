(function () {
  const METRIC_LABELS = { min:"最小值", max:"最大值", mean:"平均值", median:"中位数", q25:"25分位", q75:"75分位" };
  const LEAD_LABELS = { "3":"提前3天购买", "7":"提前7天购买", avg:"全部提前期平均" };
  let datasetPromise;

  const load = () => datasetPromise ||= fetch("./public/data/dashboard_data.json", { cache:"no-store" }).then((response) => {
    if (!response.ok) throw new Error(`公开数据包读取失败：${response.status}`);
    return response.json();
  });
  const round = (value) => value == null ? null : Math.round(value);
  const average = (values) => values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null;
  const valuesForRoute = (route) => route === "all" ? null : new Set([route]);

  function clampRange(dates, requestedStart, requestedEnd) {
    if (!dates.length) return { start:null, end:null, dates:[] };
    const min=dates[0], max=dates[dates.length-1];
    let start=requestedStart && requestedStart>=min ? requestedStart : min;
    let end=requestedEnd && requestedEnd<=max ? requestedEnd : max;
    if(start>max)start=min;
    if(end<min)end=max;
    if(start>end){start=min;end=max;}
    return { start, end, dates:dates.filter((date)=>date>=start&&date<=end) };
  }

  function dashboard(data, params) {
    const route=params.get("route")||"all", metric=METRIC_LABELS[params.get("metric")]?params.get("metric"):"median";
    const lead=["3","7","avg"].includes(params.get("lead"))?params.get("lead"):"avg";
    const routeSet=valuesForRoute(route);
    const eligible=data.daily.filter((row)=>(!routeSet||routeSet.has(row.route))&&(lead==="avg"||row.days===Number(lead)));
    const allDates=[...new Set(eligible.map((row)=>row.flightDate))].sort();
    const range=clampRange(allDates,params.get("start_date"),params.get("end_date"));
    const selected=eligible.filter((row)=>range.dates.includes(row.flightDate));
    const grouped=new Map();
    selected.forEach((row)=>{
      const key=`${row.flightDate}|${row.route}`;
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push(row);
    });
    const trend=[];
    grouped.forEach((rows,key)=>{
      const [flightDate,routeName]=key.split("|");
      trend.push({
        flightDate,route:routeName,value:round(lead==="avg"?average(rows.map((row)=>row[metric])):rows[0][metric]),
        sampleCount:rows.reduce((sum,row)=>sum+row.count,0),leadDaysCovered:rows.length,
      });
    });
    trend.sort((a,b)=>a.flightDate.localeCompare(b.flightDate)||a.route.localeCompare(b.route,"zh-CN"));
    const byRoute=new Map();
    trend.forEach((point)=>{if(!byRoute.has(point.route))byRoute.set(point.route,[]);byRoute.get(point.route).push(point);});
    const routeSummaries=[...byRoute.entries()].map(([routeName,points])=>{
      const vals=points.map((point)=>point.value),latest=[...points].sort((a,b)=>b.flightDate.localeCompare(a.flightDate))[0];
      return {route:routeName,latestFlightDate:latest.flightDate,latestValue:latest.value,periodMean:round(average(vals)),periodMin:Math.min(...vals),periodMax:Math.max(...vals),flightDateCount:points.length,sampleCount:points.reduce((sum,p)=>sum+p.sampleCount,0)};
    }).sort((a,b)=>a.route.localeCompare(b.route,"zh-CN"));
    const selectedFlights=data.flights.filter((row)=>(!routeSet||routeSet.has(row.route))&&range.dates.includes(row.flightDate));
    const pointValues=trend.map((point)=>point.value), latestDate=trend.length?[...trend].sort((a,b)=>b.flightDate.localeCompare(a.flightDate))[0].flightDate:null;
    const latestValues=trend.filter((point)=>point.flightDate===latestDate).map((point)=>point.value);
    const coverageByDate=new Map();
    data.coverage.filter((row)=>(!routeSet||routeSet.has(row.route))&&(!range.start||row.date>=range.start)&&(!range.end||row.date<=range.end)).forEach((row)=>{
      if(!coverageByDate.has(row.date))coverageByDate.set(row.date,[]);
      coverageByDate.get(row.date).push(row.batches);
    });
    const batchCoverage=[...coverageByDate.entries()].map(([date,batches])=>({date,batches:Math.min(...batches),complete:Math.min(...batches)>=7})).sort((a,b)=>a.date.localeCompare(b.date));
    const completeDates=batchCoverage.filter((row)=>row.complete).map((row)=>row.date);
    return {
      meta:{latestScrapeTime:data.sourceSummary.latestScrapeTime,selectedRoute:route,startDate:range.start,endDate:range.end,availableFlightDateRange:allDates.length?[allDates[0],allDates[allDates.length-1]]:null,metric,metricLabel:METRIC_LABELS[metric],lead,leadLabel:LEAD_LABELS[lead],flightDateRange:range.dates.length?[range.dates[0],range.dates[range.dates.length-1]]:null,scrapeDateRange:data.sourceSummary.scrapeDateRange,priceBasis:data.priceBasis,sampleCount:selected.reduce((sum,row)=>sum+row.count,0),flightCount:new Set(selectedFlights.map((row)=>row.flightNo)).size,airlineCount:new Set(selectedFlights.map((row)=>row.airline)).size,latestCompleteScrapeDate:completeDates.length?completeDates[completeDates.length-1]:null},
      filters:{routes:[{value:"all",label:"全部航线"},...data.routes.map((value)=>({value,label:value}))],metrics:Object.entries(METRIC_LABELS).map(([value,label])=>({value,label})),leads:Object.entries(LEAD_LABELS).map(([value,label])=>({value,label})),flightDates:range.dates},
      summary:{latestValue:round(average(latestValues)),periodMean:round(average(pointValues)),periodMin:pointValues.length?Math.min(...pointValues):null,periodMax:pointValues.length?Math.max(...pointValues):null,flightDateCount:new Set(trend.map((p)=>p.flightDate)).size,pointCount:trend.length},
      routeSummaries,trend,batchCoverage,
    };
  }

  function tracker(data, params) {
    const route=params.get("route")||"all", flightDate=params.get("flight_date"), metric=METRIC_LABELS[params.get("metric")]?params.get("metric"):"median";
    const routeSet=valuesForRoute(route);
    const history=data.tracker.filter((row)=>(!routeSet||routeSet.has(row.route))&&row.flightDate===flightDate).map((row)=>({scrapeDate:row.scrapeDate,route:row.route,value:row[metric],daysToDepart:row.daysToDepart,sampleCount:row.count})).sort((a,b)=>a.scrapeDate.localeCompare(b.scrapeDate)||a.route.localeCompare(b.route,"zh-CN"));
    const flights=data.flights.filter((row)=>(!routeSet||routeSet.has(row.route))&&row.flightDate===flightDate).map((row)=>({route:row.route,flightNo:row.flightNo,airline:row.airline,depTime:row.depTime,min:row.min,median:row.median,max:row.max,count:row.count})).sort((a,b)=>a.route.localeCompare(b.route,"zh-CN")||a.median-b.median);
    return {meta:{route:route==="all"?"全部航线":route,flightDate,metric,metricLabel:METRIC_LABELS[metric],priceBasis:data.priceBasis},history,flights};
  }

  window.AirfareDataProvider = {
    async query(path) {
      const data=await load();
      const url=new URL(path,"https://dashboard.local");
      if(url.pathname==="/api/airfare/dashboard")return dashboard(data,url.searchParams);
      if(url.pathname==="/api/airfare/tracker")return tracker(data,url.searchParams);
      throw new Error(`未知公开数据请求：${url.pathname}`);
    },
  };
})();

