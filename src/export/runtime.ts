// Self-contained player runtime injected into the exported .html (§5).
// Dependency-free: re-implements van Wijk pan/zoom, contain-fit, visibility and
// keyboard nav in vanilla JS so the file plays fully offline with no external fetch.
// Returned as a string and embedded in a <script> tag by exportHtml().

export function runtimeScript(): string {
  return String.raw`
(function(){
  var DATA = window.__PRES__;
  var frames = DATA.frames, elements = DATA.elements.slice().sort(function(a,b){return a.z-b.z;});
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stage = document.getElementById('stage');
  var world = document.getElementById('world');
  var progress = document.getElementById('progress');
  var index = 0, overview = false, raf = null;

  // ---- build element DOM ----
  var nodes = {};
  elements.forEach(function(el){
    var d = document.createElement('div');
    d.style.position='absolute'; d.style.left=el.x+'px'; d.style.top=el.y+'px';
    d.style.width=el.w+'px'; d.style.height=el.h+'px';
    var inner = document.createElement('div');
    inner.style.width='100%'; inner.style.height='100%';
    inner.style.transform='rotate('+el.rotation+'deg)';
    if(el.type==='text'){
      inner.innerHTML = el.content;
      var ts = el.textStyle||{};
      inner.style.fontSize=(ts.fontSize||32)+'px'; inner.style.fontWeight=(ts.fontWeight||400);
      inner.style.color=ts.color||'#000'; inner.style.textAlign=ts.align||'left';
      inner.style.display='flex'; inner.style.flexDirection='column'; inner.style.justifyContent='center';
    } else {
      var img=document.createElement('img'); img.src=el.content;
      img.style.width='100%'; img.style.height='100%'; img.style.display='block'; img.draggable=false;
      inner.appendChild(img);
    }
    d.appendChild(inner); world.appendChild(d); nodes[el.id]=d; d.style.display='none';
  });

  function vp(){ return {width: window.innerWidth, height: window.innerHeight}; }
  function frameToCam(f, v){ return {cx:f.x+f.w/2, cy:f.y+f.h/2, scale:Math.min(v.width/f.w, v.height/f.h), rotation:f.rotation}; }
  function applyCam(c){
    var v=vp();
    world.style.transform='translate('+(v.width/2)+'px,'+(v.height/2)+'px) rotate('+(-c.rotation)+'deg) scale('+c.scale+') translate('+(-c.cx)+'px,'+(-c.cy)+'px)';
  }

  // ---- van Wijk smooth zoom/pan ----
  function path(from,to,v,rho){
    rho=rho||1.4; var w0=v.width/from.scale, w1=v.width/to.scale;
    var dx=to.cx-from.cx, dy=to.cy-from.cy, u1=Math.hypot(dx,dy), rho2=rho*rho;
    var dRot=((to.rotation-from.rotation+540)%360)-180;
    if(u1<1e-6){ var S=Math.abs(Math.log(w1/w0))/rho||1e-6; return {S:S, at:function(t){var w=w0*Math.pow(w1/w0,t);return{cx:from.cx,cy:from.cy,scale:v.width/w,rotation:from.rotation+dRot*t};}};}
    var b0=(w1*w1-w0*w0+rho2*rho2*u1*u1)/(2*w0*rho2*u1);
    var b1=(w1*w1-w0*w0-rho2*rho2*u1*u1)/(2*w1*rho2*u1);
    var r0=Math.log(-b0+Math.sqrt(b0*b0+1)), r1=Math.log(-b1+Math.sqrt(b1*b1+1));
    var S=(r1-r0)/rho, ch0=Math.cosh(r0);
    return {S:Math.abs(S)||1e-6, at:function(t){var r=r0+rho*t*S; var u=(w0/(rho2*u1))*(ch0*Math.tanh(r)-Math.sinh(r0)); var w=w0*ch0/Math.cosh(r); return{cx:from.cx+dx*u,cy:from.cy+dy*u,scale:v.width/w,rotation:from.rotation+dRot*t};}};
  }
  // Proper CSS cubic-bezier easing: solve x(t)=time via Newton, then return y(t).
  // (Matches the editor's Motion easing so playback feels identical to the app.)
  function cubicBezier(x1,y1,x2,y2){
    var A=function(a,b){return 1-3*b+3*a;}, B=function(a,b){return 3*b-6*a;}, C=function(a){return 3*a;};
    var calc=function(t,a,b){return ((A(a,b)*t+B(a,b))*t+C(a))*t;};
    var slope=function(t,a,b){return 3*A(a,b)*t*t+2*B(a,b)*t+C(a);};
    return function(x){ if(x<=0)return 0; if(x>=1)return 1; var t=x;
      for(var i=0;i<6;i++){ var s=slope(t,x1,x2); if(s===0) break; t-=(calc(t,x1,x2)-x)/s; }
      return calc(t,y1,y2); };
  }
  var EASE={smooth:{e:cubicBezier(.4,0,.2,1),k:1},snappy:{e:cubicBezier(.2,.8,.2,1),k:.6},slowDrift:{e:cubicBezier(.33,0,.2,1),k:1.6},cut:{e:null,k:0}};

  var curCam = frames[0]?frameToCam(frames[0],vp()):{cx:0,cy:0,scale:1,rotation:0};
  function animateTo(target, easing, duration){
    if(raf) cancelAnimationFrame(raf);
    var v=vp(), p=path(curCam,target,v);
    var prof=EASE[easing]||EASE.smooth;
    var durMs = duration==='auto' ? Math.max(350,Math.min(2600,700*(0.4+p.S))) : duration;
    durMs *= prof.k||1;
    // will-change only while moving: left on, Chrome keeps the first raster scale and deep zooms blur.
    if(reduced||easing==='cut'||durMs<=0){ curCam=target; applyCam(target); world.style.willChange='auto'; return; }
    world.style.willChange='transform';
    var t0=performance.now();
    (function step(now){
      var t=Math.min(1,(now-t0)/durMs); var et=prof.e?prof.e(t):t;
      var c=p.at(et); applyCam(c);
      if(t<1){ raf=requestAnimationFrame(step); } else { curCam=target; world.style.willChange='auto'; }
    })(t0);
  }

  // ---- visibility (mirrors visibility.ts) ----
  function idxOf(id){ for(var i=0;i<frames.length;i++) if(frames[i].id===id) return i; return -1; }
  function visAt(el,i){
    var lc=el.lifecycle||{}; var enter = lc.enterAt? idxOf(lc.enterAt):0;
    if(i<enter) return false;
    var leave=Infinity;
    if(lc.onExit==='leave'){ var ref=lc.exitAt||lc.enterAt; var li=ref?idxOf(ref):enter; leave=li>=0?li:enter; }
    return i<=leave;
  }
  function render(i){
    elements.forEach(function(el){
      var on=visAt(el,i), node=nodes[el.id], wasOn=node.style.display!=='none';
      if(on&&!wasOn){ node.style.display=''; entrance(el,node); }
      else if(!on&&wasOn){ exit(el,node); }
    });
  }
  function entrance(el,node){
    if(reduced) return; var lc=el.lifecycle||{}; if(idxOf(lc.enterAt)!==index) return;
    var eff=lc.enterEffect;
    if(eff==='fade'){ node.animate([{opacity:0},{opacity:1}],{duration:500,easing:'ease-out'}); }
    else if(eff==='slide'){ var o=offset(lc.enterDirection); node.animate([{opacity:0,transform:'translate('+o.x+'px,'+o.y+'px)'},{opacity:1,transform:'none'}],{duration:500,easing:'ease-out'}); }
    else if(eff==='pulse'){ node.animate([{transform:'scale(1)'},{transform:'scale(1.08)'},{transform:'scale(1)'}],{duration:600}); }
  }
  function exit(el,node){
    var lc=el.lifecycle||{};
    if(reduced||lc.onExit!=='leave'||lc.exitEffect==='none'){ node.style.display='none'; return; }
    var o=lc.exitEffect==='slide'?offset(lc.enterDirection):{x:0,y:0};
    var a=node.animate([{opacity:1},{opacity:0,transform:'translate('+o.x+'px,'+o.y+'px)'}],{duration:400,easing:'ease-in'});
    a.onfinish=function(){ node.style.display='none'; };
  }
  function offset(dir){ var d=80; return dir==='right'?{x:d,y:0}:dir==='up'?{x:0,y:-d}:dir==='down'?{x:0,y:d}:{x:-d,y:0}; }

  // ---- deep links (mirrors deepLink.ts): #title-slug or #number ----
  function slugOf(t){ return String(t||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
  var taken={}, hashes=frames.map(function(f,i){ var s=slugOf(f.title); if(!s||/^\d+$/.test(s)||taken[s]) return String(i+1); taken[s]=1; return s; });
  function frameFromHash(hash){
    var h=hash.replace(/^#/,''); try{ h=decodeURIComponent(h); }catch(e){ return -1; } h=h.toLowerCase();
    if(/^\d+$/.test(h)){ var n=Number(h); return n>=1&&n<=hashes.length?n-1:-1; }
    return h?hashes.indexOf(h):-1;
  }
  function setHash(i){ try{ history.replaceState(null,'','#'+hashes[i]); }catch(e){} }

  function go(i){
    i=Math.max(0,Math.min(frames.length-1,i)); var f=frames[i]; if(!f) return;
    overview=false; index=i; render(i); setHash(i);
    animateTo(frameToCam(f,vp()), f.easing, f.duration);
    if(progress) progress.style.width=((i+1)/frames.length*100)+'%';
  }
  function bounds(){
    if(!elements.length) return {x:-640,y:-360,w:1280,h:720,rotation:0};
    var x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    elements.forEach(function(e){x0=Math.min(x0,e.x);y0=Math.min(y0,e.y);x1=Math.max(x1,e.x+e.w);y1=Math.max(y1,e.y+e.h);});
    var px=(x1-x0)*0.1, py=(y1-y0)*0.1; return {x:x0-px,y:y0-py,w:(x1-x0)+2*px,h:(y1-y0)+2*py,rotation:0};
  }
  function toggleOverview(){ if(overview){ go(index); } else { overview=true; animateTo(frameToCam(bounds(),vp()),'smooth','auto'); } }

  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown'){ e.preventDefault(); overview?go(index):go(index+1); }
    else if(e.key==='ArrowLeft'||e.key==='PageUp'){ e.preventDefault(); overview?go(index):go(index-1); }
    else if(e.key==='Home'){ go(0); } else if(e.key==='End'){ go(frames.length-1); }
    else if(e.key==='o'||e.key==='O'){ toggleOverview(); }
  });
  stage.addEventListener('click',function(){ overview?go(index):go(index+1); });
  window.addEventListener('resize',function(){ applyCam(curCam); });
  window.addEventListener('hashchange',function(){ var i=frameFromHash(location.hash); if(i>=0&&(i!==index||overview)) go(i); });

  if(frames.length){
    index=Math.max(0,frameFromHash(location.hash)); curCam=frameToCam(frames[index],vp());
    render(index); applyCam(curCam); if(progress) progress.style.width=((index+1)/frames.length*100)+'%';
  }
})();`;
}
