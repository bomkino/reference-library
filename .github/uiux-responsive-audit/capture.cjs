const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)); const out=process.env.SCREENSHOT_DIR; fs.mkdirSync(out,{recursive:true});
const evaluate=(win,label,source)=>win.webContents.executeJavaScript(source).catch(error=>{console.error(label,error);throw error});
async function waitFor(win,label,expression){for(let i=0;i<60;i++){if(await evaluate(win,label,`Boolean(${expression})`))return;await wait(100);}throw new Error(`Timed out: ${label}`);}
async function capture(win,name){await wait(220);const image=await win.webContents.capturePage();fs.writeFileSync(path.join(out,`${name}.png`),image.toPNG());console.log(name);}
async function clickText(win,selector,text){return evaluate(win,`click ${text}`,`(()=>{const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim().startsWith(${JSON.stringify(text)}));if(!node)throw new Error('Missing ${text}');node.click();return true})()`);}
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1728,height:1117,show:false,backgroundColor:'#eef2ff',webPreferences:{preload:process.env.PRELOAD,contextIsolation:true,nodeIntegration:false,sandbox:false}});
  try{
    await win.loadFile(process.env.INDEX_HTML); await waitFor(win,'first run',"document.querySelector('.document-empty')"); await capture(win,'00-first-run');
    await clickText(win,'.document-empty button','New Library'); await waitFor(win,'workspace',"document.querySelector('.workspace-shell')"); await waitFor(win,'asset',"document.querySelector('[data-asset-id=\"asset-1\"]')"); await capture(win,'01-desktop-canvas');
    await evaluate(win,'select',"document.querySelector('[data-asset-id=\"asset-1\"]').click()"); await waitFor(win,'inspector',"document.querySelector('.inspector input')"); await capture(win,'02-desktop-inspector');
    for(const id of ['asset-1','asset-2','asset-3','asset-4']){await evaluate(win,`shortlist ${id}`,`document.querySelector('[data-asset-id=\"${id}\"] [data-shortlist-toggle]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);await wait(80);} await capture(win,'03-desktop-shortlist');
    await clickText(win,'.selection-tray button','Compare'); await waitFor(win,'compare',"document.querySelector('.compare-board')"); await capture(win,'04-compare-board'); await clickText(win,'.compare-board button','Close');
    win.setSize(1180,900); await wait(700); await capture(win,'05-medium-canvas');
    await clickText(win,'.topbar__actions button','Library'); await waitFor(win,'library drawer',"document.querySelector('.sidebar--drawer-open')"); await capture(win,'06-medium-library-drawer'); await clickText(win,'.sidebar button','Close');
    await clickText(win,'.topbar__actions button','Inspector'); await waitFor(win,'inspector drawer',"document.querySelector('.inspector--drawer-open')"); await capture(win,'07-medium-inspector-drawer'); await clickText(win,'.inspector button','Close');
    win.setSize(720,1100); await wait(700); await capture(win,'08-narrow-canvas');
    await clickText(win,'.topbar__actions button','Library'); await waitFor(win,'narrow library',"document.querySelector('.sidebar--drawer-open')"); await capture(win,'09-narrow-library-drawer'); await clickText(win,'.sidebar button','Close');
    await clickText(win,'.topbar__actions button','Inspector'); await waitFor(win,'narrow inspector',"document.querySelector('.inspector--drawer-open')"); await capture(win,'10-narrow-inspector-drawer');
  }catch(error){console.error(error);try{await capture(win,'99-failure')}catch{}process.exitCode=1;}finally{await win.close();app.quit();}
}).catch(error=>{console.error(error);app.exit(1)});
