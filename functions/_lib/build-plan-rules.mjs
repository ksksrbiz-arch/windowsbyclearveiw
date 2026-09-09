export const BUILD_PLAN_KNOWLEDGE_VERSION = '2026-09-08.2';

// Durable rules are separated from product-specific requirements. Product-specific
// fasteners, clearances, flashing sequences, sealants and warranty conditions must
// be verified against the selected manufacturer's written instructions.
export const AUTHORITIES = [
  { id:'WA-R703', title:'Washington 2021 IRC adoption / R703 exterior covering', status:'authoritative', note:'Washington adopts the 2021 IRC with state amendments; exterior window/door openings are subject to flashing and weather-resistive-envelope requirements.' },
  { id:'FGIA-INSTALL', title:'FGIA InstallationMasters / manufacturer instructions', status:'industry-standard', note:'Installation practice should follow the specific fenestration manufacturer's written installation and flashing instructions.' },
  { id:'BSC-DRAIN', title:'Building Science Corporation drained-opening principles', status:'building-science', note:'Water reaching an opening should have a controlled path to the exterior; opening drainage should not depend on sealant alone.' },
];

// These are source registries, not permission to invent product requirements.
// A series/model-specific document must outrank these general references.
export const PRODUCT_SOURCES = [
  { id:'CASCADE-GENERAL', manufacturer:'Cascade Windows', scope:'general window installation', url:'https://www.cascadewindows.com/wp-content/uploads/2026/01/Cascade-Window-Installation-2022.pdf', rule:'Use only as a general Cascade reference; confirm the exact ordered product and current instructions before specifying fasteners, sealant, flashing or dimensions.' },
  { id:'CASCADE-HUB', manufacturer:'Cascade Windows', scope:'manufacturer technical/how-to resources', url:'https://cascadewindows.com/how-to-instructions/', rule:'Use to locate current product-specific resources and care/installation information.' },
  { id:'MILGARD-HUB', manufacturer:'Milgard', scope:'product-specific technical resources', url:'https://www.milgard.com/technical-resources?f%5B0%5D=product_downloads_recource_type%3AInstallation+Instructions', rule:'Select the exact series/product and installation method before using technical details.' },
  { id:'MILGARD-SUPPLEMENT', manufacturer:'Milgard', scope:'general installation supplement', url:'https://www.milgard.com/sites/default/files/technical-resources/files/milgard_installation_supplement.pdf', rule:'General supplement only; it explicitly directs installers to specific installation-method instructions.' },
];

export const MATERIAL_RULES = [
  { id:'M-UNIT', name:'Quoted window/door unit', category:'quote-derived', trigger:'always', action:'Buy exactly the quoted product, size, configuration, handing and quantity; verify against the order confirmation.' },
  { id:'M-SHIM', name:'Compatible shims', category:'baseline', trigger:'window-or-door', action:'Provide compatible shims; final placement/count depends on product instructions and opening conditions.' },
  { id:'M-FASTENER', name:'Manufacturer-approved fasteners', category:'verify', trigger:'window-or-door', action:'Do not invent size, type, length or spacing. Verify the selected product installation instructions before purchase.' },
  { id:'M-FLASH', name:'Flashing / sill protection system', category:'conditional', trigger:'opening-and-installation-path', action:'Select a compatible flashing system appropriate to the opening, wall/drainage design and manufacturer's instructions.' },
  { id:'M-SEAL', name:'Compatible sealant', category:'conditional', trigger:'perimeter-sealing', action:'Verify substrate/product compatibility and the manufacturer's approved sealant before purchase.' },
  { id:'M-INSUL', name:'Low-expansion window/door insulation', category:'conditional', trigger:'perimeter-gap', action:'Use a product appropriate for window/door perimeter gaps and follow the unit manufacturer's instructions; do not obstruct drainage/weep paths.' },
  { id:'M-WRB', name:'WRB / flashing transition materials', category:'conditional', trigger:'new-construction-or-exposed-opening', action:'Verify the existing/new wall water-resistive barrier and required transition details before ordering quantities.' },
  { id:'M-TRIM', name:'Trim / finish materials', category:'site-derived', trigger:'finish-scope', action:'Do not assume trim quantity from window count alone. Measure existing conditions and use quoted scope.' },
  { id:'M-PROTECT', name:'Floor/wall/site protection and cleanup supplies', category:'baseline', trigger:'replacement', action:'Protect finished surfaces and remove debris without damaging finishes.' },
];

export const INSTALL_RULES = [
  { id:'I-01', phase:'PRECHECK', text:'Confirm the ordered unit, configuration, size, handing and opening assignment before removal or setting.' },
  { id:'I-02', phase:'PRECHECK', text:'Confirm the installation path: insert/retrofit, full-frame, or new construction. Do not infer the method from window type alone.' },
  { id:'I-03', phase:'PROTECT', text:'Protect interior and exterior finished surfaces and establish a controlled removal/cleanup area.' },
  { id:'I-04', phase:'OPENING', text:'After removal where applicable, inspect the opening, sill, framing and water-management layers for damage or incompatible conditions.' },
  { id:'I-05', phase:'OPENING', text:'Stop and document concealed damage, rot, framing problems, unexpected substrate conditions, or water-management defects before proceeding.' },
  { id:'I-06', phase:'WATER', text:'Install the sill/perimeter water-management system required by the selected product and the wall/opening conditions.' },
  { id:'I-07', phase:'SET', text:'Set the unit according to the manufacturer's written installation instructions; establish proper support, alignment and required clearances.' },
  { id:'I-08', phase:'FASTEN', text:'Fasten only with the selected product's approved method, fastener specification and spacing. These details are VERIFY items unless product data is attached.' },
  { id:'I-09', phase:'WATER', text:'Complete perimeter flashing, sealant and WRB transitions according to the applicable system. Preserve intended drainage paths.' },
  { id:'I-10', phase:'AIR', text:'Air-seal the interior perimeter gap where required by the installation system, without blocking designed drainage/weep paths.' },
  { id:'I-11', phase:'FINISH', text:'Complete insulation, trim and finish work only to the scope actually quoted or approved after site verification.' },
  { id:'I-12', phase:'QC', text:'Operate and inspect the completed unit, verify alignment/operation and inspect visible water-management transitions before closeout.' },
];

export const QC_RULES = ['Ordered product/configuration matches the opening','Unit is properly aligned and supported per product instructions','Fasteners and fastening method verified against product instructions','Flashing/water-management sequence completed and visible transitions checked','Sealant is compatible and continuous where required','Interior perimeter air sealing/insulation completed as specified','Drainage/weep paths remain clear','Unit operates, locks and latches correctly','Interior/exterior finish is clean and undamaged','Required installation and closeout photos captured'];

export function materialPlan({projectType='unknown',openings=[]}={}) {
  const replacement=projectType!=='new-construction';
  return MATERIAL_RULES.filter(r=>{if(r.trigger==='always')return true;if(r.trigger==='replacement')return replacement;if(r.trigger==='window-or-door')return openings.length>0;if(r.trigger==='opening-and-installation-path')return openings.length>0;if(r.trigger==='perimeter-sealing')return openings.length>0;if(r.trigger==='perimeter-gap')return openings.length>0;if(r.trigger==='new-construction-or-exposed-opening')return projectType==='new-construction';if(r.trigger==='finish-scope')return true;return false;});
}
function normalize(s){return String(s||'').toLowerCase();}
export function lintPlan(plan,items=[]) {
  const warnings=[],blockers=[],openings=Array.isArray(plan?.openings)?plan.openings:[],buy=Array.isArray(plan?.buy)?plan.buy:[],verify=Array.isArray(plan?.verify)?plan.verify:[],install=Array.isArray(plan?.install)?plan.install:[],buyText=normalize(buy.join(' ')),verifyText=normalize(verify.join(' ')),installText=normalize(install.join(' '));
  if(!openings.length&&items.length)blockers.push('No opening schedule exists for a quote that contains line items.');
  if(openings.length&&openings.some(o=>!o.product||normalize(o.product).includes('quoted opening')))warnings.push('One or more openings still use a generic product label; match each opening to the ordered unit.');
  if(openings.some(o=>!o.dimensions||normalize(o.dimensions).includes('verify')))warnings.push('One or more opening dimensions are still VERIFY items.');
  if(openings.some(o=>o.openingType==='unknown'))warnings.push('One or more opening types are unknown; confirm before finalizing the field plan.');
  if(!/manufacturer|product.*instruction|installation.*instruction/.test(verifyText+installText))blockers.push('Manufacturer/product installation instructions are not explicitly represented in the verification plan.');
  if(/(#?\s*\d+\s*x\s*\d+\s*(screw|fastener)|\d+\s*in\.?\s*o\.c\.|on center)/.test(buyText+installText))blockers.push('The plan contains a specific fastener or spacing specification without a product-data source. Remove it or attach the manufacturer requirement.');
  if(/(exactly|must buy)\s+\d+\s+(roll|tube|box|can)/.test(buyText))warnings.push('A hard purchase quantity appears in BUY; confirm the quantity from measurements, product instructions and actual opening conditions.');
  if(!/flash|sill|water/.test(verifyText+installText))blockers.push('The plan does not contain an explicit water-management verification step.');
  if(!/weep|drain/.test(verifyText+installText))warnings.push('Confirm that designed drainage/weep paths remain clear after installation.');
  if(!/operation|operate|lock|latch/.test(installText+normalize((plan?.qc||[]).join(' '))))warnings.push('Final operation/lock/latch verification is missing.');
  if(items.length&&openings.length){const quotedQty=items.reduce((n,i)=>n+Math.min(50,Math.max(1,Number(i.quantity)||1)),0);if(quotedQty!==openings.length)warnings.push(`Quote quantity (${quotedQty}) and opening schedule (${openings.length}) do not match; reconcile before ordering.`);}
  return{blockers,warnings,knowledgeVersion:BUILD_PLAN_KNOWLEDGE_VERSION};
}
export function sourceSnapshot(items=[]){return items.map((item,index)=>({index,label:String(item.label||''),quantity:Number(item.quantity)||0,description:String(item.description||''),lineTotalCents:Number(item.line_total_cents)||0}));}
