/* globals JSZip,saveAs */
// Enforce the use of https because some features require secure context. 
if (location.protocol !== 'https:') {
    location.replace(`https:${location.href.substring(location.protocol.length)}`);
}

const MODRINTH_API_BASE = "https://api.modrinth.com/v2";
const MODRINTH_FRONTEND = localStorage.getItem("preferRewrite") ? "https://rewrite.modrinth.com":"https://modrinth.com"
const VERSION = "1.1.0"; // follow semantic versioning

async function readFileToBuffer(file){
  return new Promise((resolve,reject) => {
    try{
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    }catch(ex){
      reject(ex);
    }
  });
}

function hexify(hash){
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// From: https://stackoverflow.com/a/14919494/10818862
function humanFileSize(bytes, si=false, dp=1) {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }

  const units = si 
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] 
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10**dp;

  do {
    bytes /= thresh;
    ++u;
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);


  return bytes.toFixed(dp) + ' ' + units[u];
}

let tableKeys = [];

function keyToggle(mod, el, index, key){
  if(el.children().length == 0){
    el.append($("<input>").attr("type","checkbox").attr("title","Toggles " + key + " attribute").addClass("toggle").prop("checked",mod[key]).on("change", function(ev) {
      mod[key] = !mod[key];
      $(this).prop("checked",mod[key]);
    }));
  }else{
    el.children().prop("checked",mod[key]);
  }
}

const altColumnRender = {
  icon_url: (mod, el) => {
    if(el.children().length == 0){
      const img = $("<img>").attr("src",mod.icon_url).addClass("mod-icon")
      const anchor = $("<a>").attr("href","#").append(img);
      el.append(anchor);
      if(mod.slug){
        anchor.attr("href",MODRINTH_FRONTEND + "/mod/" + mod.slug);      
      }else if(mod.project_id){
        anchor.attr("href",MODRINTH_FRONTEND + "/mod/" + mod.project_id);      
      }
    }
    
    console.log(el.children().length);
  },
  game_versions: (mod, el) => el.text(mod.game_versions.join(",")),
  loaders: (mod, el) => el.text(mod.loaders.join(",")),
  server_apply: keyToggle,
  client_apply: keyToggle,
  filesize: (mod, el) => el.attr("title",mod.filesize + " bytes").text(humanFileSize(mod.filesize))
};

function update(mod){
  let key = "mod-" + mod.sha512;
  if(!$("#" + key).length){
    let row = $("<tr>")
    row.attr("id",key);
    for(let i = 0; i < tableKeys.length; i ++){
      row.append($("<td>").addClass("key-" + tableKeys[i]));
    }
    $("#mods-table").append(row);
  }
  let row = $("#" + key);
  if(mod.description){
    row.attr("title",mod.description);
  }
  row.children().each((index, el) => {
    if(mod[tableKeys[index]]){
      console.log("Checking",mod,tableKeys[index]);
      if(altColumnRender[tableKeys[index]]){
        altColumnRender[tableKeys[index]](mod,$(el),index,tableKeys[index]);
      }else{
        $(el).text(mod[tableKeys[index]].toString());
      }
    }else{
      $(el).text("");
    }
  });
}

let fileCount = 0;
let modList = [];

function wait(ms){
  return (new Promise((resolve,reject) => setTimeout(resolve,ms)));
}

function log(msg){
  $("#log").append($(document.createTextNode(msg.toString() + "\n")));
}

// We shall respect ratelimits!
let modrinthBannedUsUntil = 0;

async function fetchModrinth(url, options = {}){
  if(Date.now() < modrinthBannedUsUntil){
    await wait(modrinthBannedUsUntil - Date.now());
  }
  if(!options.headers){
    options.headers = {};
  }
  options.headers["User-Agent"] = "Packgen/" + VERSION + " (Bleeding edge at https://modrinth-packgen.glitch.me)"; // Compilance with requests by Rinth Team.
  let resp = await fetch(MODRINTH_API_BASE + url, options);
  if(resp.headers.get("X-Ratelimit-Remaining") == "0"){
    console.log("Hit ratelimit :(");
    modrinthBannedUsUntil = Date.now() + 1000 * parseInt(resp.headers.get("X-Ratelimit-Reset"));
  }
  if(resp.status == 404){
    throw new Error("404 Not Found!");
  }
  return resp;
}

async function addFile(file){
  if(!file.name.endsWith(".jar")){
    return;
  }
  let fileBuffer = await readFileToBuffer(file);
  let sha1 = hexify(await crypto.subtle.digest('SHA-1', fileBuffer));
  let sha512 = hexify(await crypto.subtle.digest('SHA-512', fileBuffer));
  let mod = {
    sha1:sha1,
    sha512:sha512,
    filename: file.name,
    server_apply: true,
    client_apply: true,
    filesize: file.size,
    override: false,
    arrayBuffer: fileBuffer
  };
  modList.push(mod);
  update(mod);
  try{
    let versionFileData = await (await fetchModrinth("/version_file/" + sha512 + "?algorithm=sha512")).json();
    mod.project_id = versionFileData.project_id;
    mod.downloads = versionFileData.downloads;
    mod.game_versions = versionFileData.game_versions;
    mod.loaders = versionFileData.loaders;
    mod.dl_url = versionFileData.files[0].url
    update(mod);

    let projectData = await (await fetchModrinth("/project/" + mod.project_id)).json();
    mod.mod_name = projectData.title; 
    mod.name = projectData.title; 
    mod.description = projectData.description; 
    mod.icon_url = projectData.icon_url;
    if(projectData.slug) mod.slug = projectData.slug;
    
    update(mod);
  }catch(ex){
    log("Applying override for " + file.name + " due to " + ex);
    mod.name = "Unknown";
    mod.mod_name = "Unknown";
    mod.override = true;
    update(mod);
  }
}

async function addModFromFileHandle(filename,fileHandle){
  await addFile(await fileHandle.getFile());
}

async function recursivelyAddMods(dirHandle){
  for await (const [key, value] of dirHandle.entries()) {
    if(value.kind == "directory"){
      await recursivelyAddMods(value);
    }else{
      await addModFromFileHandle(key, value);
      fileCount ++;
      $("#files-processed").text(fileCount + " files processed...");
    }
  }
}

function guessTarget(){
  let commonVersion = modList.map(mod => mod.game_versions).reduce((a,b) => {
    if(!a || a.length == 0) return b;
    if(!b || b.length == 0) return a;
    return a.filter(val => b.includes(val));
  }) || [];
  let commonLoader = modList.map(mod => mod.loaders).reduce((a,b) => {
    if(!a || a.length == 0) return b;
    if(!b || b.length == 0) return a;
    return a.filter(val => b.includes(val));
  }) || [];
  console.log("Commons",commonLoader,commonVersion);
  log("Guessing Target: Loader -> " + commonLoader[0] + " Game Version -> " + commonVersion);
  if(commonLoader[0]) $("#loader").val(commonLoader[0]);
  if(commonVersion[0]) $("#mc-version").val(commonVersion[0]);
}

function resetMods(){
  fileCount = 0;
  modList = [];
}

$(function(){
  tableKeys = $("#mods-header-row").children().map((index,el) => $(el).attr("data-key"))
  
  $("#pick-directory").click(function(ev){
    window.showDirectoryPicker({
      id: "mods-select",
      mode: "read"
    }).then(async rootDirHandle => {
      resetMods();
      await recursivelyAddMods(rootDirHandle);
      guessTarget();
    });
  });

  $("#pick-files").on("change", async function(ev){
      resetMods();
      for(let file of $(this).prop("files")){
        await addFile(file)
        fileCount ++;
        $("#files-processed").text(fileCount + " files processed...");
      }
    guessTarget();
  });
  
  $("#export").click(async function(ev){
    const zip = new JSZip();
    
    let mrpack = {
      formatVersion: 1,
      name: $("#pack-name").val(),
      game: "minecraft",
      versionId: $("#pack-version").val(),
      summary: $("#pack-summary").val(),
      files: modList.filter(mod => !mod.override).map(mod => {
        return {
          hashes: {
            sha1: mod.sha1,
            sha512: mod.sha512
          },
          env: {
            client: mod.client_apply ? "required":"unsupported",
            server: mod.server_apply ? "required":"unsupported"
          },
          fileSize: mod.filesize,
          path: "mods/" + mod.filename,
          downloads: [
            mod.dl_url
          ]
        }
      }),
      dependencies: {
        "minecraft": $("#mc-version").val()
      }
    }
    
    zip.file("modrinth.index.json",JSON.stringify(mrpack,null,4)); 
    
    for(let mod of modList.filter(mod => mod.override)){
      log("Adding override " + mod.filename);
      let overrideDir = "overrides/mods/";
      if(mod.client_apply && !mod.client_apply){
        overrideDir = "server-overrides/mods/";
      }else if(!mod.client_apply && mod.client_apply){
        overrideDir = "client-overrides/mods/";
      }
      zip.file(overrideDir + mod.filename, mod.arrayBuffer);
    }
    
    const blob = await zip.generateAsync({type:"blob"})
    saveAs(blob, mrpack.name + ".mrpack");
  });
});