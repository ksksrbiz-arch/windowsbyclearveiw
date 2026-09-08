import { estimatePrice } from './pricing.mjs';
import { webSearch } from './search.mjs';
import { BUSINESS_FACTS } from './facts.mjs';
import guidesIndex from '../_data/guides-index.json';

function clean(value,max=300){return String(value??'').trim().slice(0,max)}
function normalizeType(v){const q=clean(v).toLowerCase();if(/double.?hung/.test(q))return 'double-hung';if(/slider|sliding window/.test(q))return 'slider';if(/casement/.test(q))return 'casement';if(/picture|fixed/.test(q))return 'picture/fixed';if(/awning/.test(q))return 'awning';if(/sliding door|patio door/.test(q))return 'sliding door';return 'unknown'}
function tokens(value){return clean(value,600).toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g)||[]}
function searchKnowledge(query){
  const q=clean(query,600),qt=tokens(q),qSet=new Set(qt);
  if(!qt.length)return {results:[]};
  const results=guidesIndex.chunks.map(chunk=>{
    const text=`${chunk.title} ${chunk.topic} ${chunk.heading} ${chunk.text}`.toLowerCase();
    const tt=tokens(text),freq=new Map();
    for(const t of tt)freq.set(t,(freq.get(t)||0)+1);
    let overlap=0;
    for(const t of qSet)if(freq.has(t))overlap++;
    const phrase=q.toLowerCase().length>8&&text.includes(q.toLowerCase())?2:0;
    const titleTokens=tokens(`${chunk.title} ${chunk.heading}`),titleHits=titleTokens.filter(t=>qSet.has(t)).length;
    const score=overlap/Math.max(1,Math.sqrt(qSet.size*new Set(tt).size))+titleHits*.08+phrase;
    return {title:chunk.title,heading:chunk.heading,topic:chunk.topic,url:chunk.url,text:chunk.text,score};
  }).filter(x=>x.score>.06).sort((a,b)=>b.score-a.score).slice(0,5);
  return {results};
}

export function toolsForGroq(){return [
 {type:'function',function:{name:'estimate_price',description:'Calculate a planning-level Clearview estimate only when the visitor asks about actual cost or requests an estimate. Never use for arbitrary guesses.',parameters:{type:'object',properties:{openings:{type:'string',enum:['1','2–5','6–10','10+']},home_type:{type:'string',enum:['Existing home','New construction']},complexity:{type:'string',enum:['standard','moderate','complex']}},required:['openings','home_type','complexity']} }},
 {type:'function',function:{name:'search_knowledge',description:'Search the site guide knowledge base for a Clearview-relevant technical answer. Use it when the preloaded excerpts do not fully answer the question or when a specific guide section is needed.',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']} }},
 {type:'function',function:{name:'get_business_facts',description:'Return verified business facts such as service area and appointment policy.',parameters:{type:'object',properties:{topic:{type:'string'}},required:['topic']} }},
 {type:'function',function:{name:'search_web',description:'Search current public information when freshness matters. Clearly distinguish external information from Clearview policy.',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']} }},
 {type:'function',function:{name:'compare_installation_paths',description:'Structure the practical tradeoffs between insert and full-frame replacement. Use when the visitor is deciding between replacement methods.',parameters:{type:'object',properties:{frame_condition:{type:'string'},trim_condition:{type:'string'},disruption_tolerance:{type:'string'},opening_access:{type:'string'}},required:[]}}},
 {type:'function',function:{name:'photo_next_view',description:'Choose the single most useful additional photo view when the current photo cannot answer the question.',parameters:{type:'object',properties:{question:{type:'string'},visible_detail:{type:'string'},suspected_area:{type:'string'}},required:['question']}}}
]}
export function toolsForGemini(){return toolsForGroq().map(t=>({functionDeclarations:[t.function]}))}

export async function runTool(name,args={}){switch(name){case'estimate_price':return estimatePrice(args);case'search_knowledge':return searchKnowledge(args.query);case'get_business_facts':return BUSINESS_FACTS;case'search_web':return await webSearch(clean(args.query,500));case'compare_installation_paths':return compareInstallationPaths(args);case'photo_next_view':return photoNextView(args);default:return {error:`Unknown tool: ${name}`}}}
function compareInstallationPaths(args){const frame=clean(args.frame_condition,200).toLowerCase(),trim=clean(args.trim_condition,200).toLowerCase(),access=clean(args.opening_access,200).toLowerCase(),disruption=clean(args.disruption_tolerance,200).toLowerCase();const fullReasons=[];const insertReasons=[];if(/rot|soft|damag|failed|water/.test(frame))fullReasons.push('existing frame condition may favor exposing the rough opening');if(/good|sound|solid|stable/.test(frame))insertReasons.push('a sound existing frame can support an insert approach');if(/need.*new|replace.*trim|rough opening|siding|sheath/.test(access))fullReasons.push('opening access can make full-frame work more practical');if(/low|minimal|avoid|little/.test(disruption))insertReasons.push('lower interior/exterior disruption can favor an insert approach');if(/high|major|okay with/.test(disruption))fullReasons.push('greater disruption tolerance makes full-frame work easier to consider');if(/replace|damag|rot/.test(trim))fullReasons.push('trim condition may support a more complete opening correction');return {insert:{when:insertReasons.length?insertReasons:['existing frame is sound and preserving surrounding finish is valuable']},fullFrame:{when:fullReasons.length?fullReasons:['existing frame condition or opening access calls for a more complete opening evaluation']},inspectionNeeded:!fullReasons.length&&!insertReasons.length}}
function photoNextView(args){const q=clean(args.question,300).toLowerCase(),area=clean(args.suspected_area,200).toLowerCase();if(/glass|fog|seal|condens/.test(q)||/glass/.test(area))return {view:'close-up of the glass',why:'Shows the pane, spacer area, haze or visible seal-related symptoms more clearly.'};if(/frame|trim|rot|damage|sash/.test(q)||/frame|trim|rot|damage|sash/.test(area))return {view:'inside frame and trim',why:'Shows the condition of the frame, sash and surrounding trim.'};if(/water|leak|flashing|installation|siding|exterior/.test(q)||/water|flashing|exterior/.test(area))return {view:'exterior perimeter of the window',why:'Shows the visible exterior interface and any accessible installation details.'};return {view:'whole window from inside',why:'Establishes the overall unit, surrounding trim and opening context before zooming in.'}}
