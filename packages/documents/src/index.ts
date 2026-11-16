/// <reference path="./pdfkit.d.ts" />
import PDFDocument from 'pdfkit';
import {fileURLToPath} from 'node:url';
export type CertificateDetails={recipient_name:string;course_name:string;awarded_on:string;style:'NAMASTEDEV'|'UDEMY';certificate_type:'COURSE'|'COMPLETION';instructor_name?:string};
export type DocumentOptions={template?:'STANDARD'|'COURSE'|'UDEMY'|'SERVICE';order_reference?:string;place_of_supply?:string;shipping_address?:string;service_start?:string;service_end?:string;notes?:string;certificates?:CertificateDetails[]};
type Doc=PDFDocument;
const clean=(v:unknown)=>String(v??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'');
const number=(v:unknown)=>Number(v??0);
const money=(v:unknown)=>`₹${number(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const address=(v:any)=>typeof v==='string'?v:Object.values(v??{}).filter(Boolean).join(', ');
const date=(v:unknown)=>v?String(v).slice(0,10):'—';
function text(doc:Doc,value:unknown,x:number,y:number,width:number,size=10,color='#202938',bold=false,align:'left'|'right'|'center'='left',height?:number){
  doc.font(bold?'Strong':'Body').fontSize(size).fillColor(color).text(clean(value),x,y,{width,align,lineGap:3,...(height?{height}:{})});
}
function fit(doc:Doc,value:string,width:number,start:number,min=10){let size=start;while(size>min&&doc.font('Strong').fontSize(size).widthOfString(value)>width)size--;return size;}
function fitBlock(doc:Doc,value:string,width:number,maxHeight:number,start:number,min=8){
  let size=start;
  while(size>min&&doc.font('Strong').fontSize(size).heightOfString(clean(value),{width,lineGap:3})>maxHeight)size--;
  return size;
}
function height(doc:Doc,value:unknown,width:number,size=10){return doc.font('Body').fontSize(size).heightOfString(clean(value),{width,lineGap:3});}
function create(draw:(doc:Doc)=>void,landscape=false):Promise<Buffer>{
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',layout:landscape?'landscape':'portrait',margin:0,bufferPages:true,info:{Producer:'Invoice SaaS',Creator:'Invoice SaaS'}}),chunks:Buffer[]=[];
    doc.on('data',(chunk:Buffer)=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    try{
      doc.registerFont('Body',fileURLToPath(new URL('../fonts/LiberationSans-Regular.ttf',import.meta.url)));
      doc.registerFont('Strong',fileURLToPath(new URL('../fonts/LiberationSans-Bold.ttf',import.meta.url)));
      draw(doc);doc.end();
    }catch(error){doc.destroy(error as Error);reject(error);}
  });
}
const small=['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const tens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function words(n:number):string{
  if(n<20)return small[n]??'';if(n<100)return `${tens[Math.floor(n/10)]}${n%10?' '+words(n%10):''}`;
  for(const [unit,label] of [[1e7,'Crore'],[1e5,'Lakh'],[1000,'Thousand'],[100,'Hundred']] as const)if(n>=unit)return `${words(Math.floor(n/unit))} ${label}${n%unit?' '+words(n%unit):''}`;
  return '';
}
function amountWords(value:unknown){const paise=Math.round(number(value)*100),whole=Math.floor(paise/100);return `${words(whole)} Rupees${paise%100?' and '+words(paise%100)+' Paise':''} Only`;}

export function renderInvoicePdf(header:any,lines:any[]):Promise<Buffer>{
  const options:DocumentOptions=header.document_options??{},dark=options.template==='COURSE',service=options.template==='SERVICE',udemy=options.template==='UDEMY',splitTax=service||udemy;
  return create(doc=>{
    const W=doc.page.width,H=doc.page.height,M=34,content=W-M*2;
    const bg=dark?'#202b3b':'#ffffff',ink=dark?'#f5f7fa':'#182432',muted=dark?'#bcc5d2':'#5c6875',border=dark?'#566378':'#c6cdd5',accent=dark?'#eead31':service?'#16858b':options.template==='UDEMY'?'#7d38de':'#182432';
    const seller=header.seller??header.seller_snapshot??{},customer=header.customer??header.customer_snapshot??{};
    let page=0;
    function canvas(continued=false){
      page++;doc.rect(0,0,W,H).fill(bg);doc.rect(M,22,42,4).fill(accent);
      text(doc,seller.business_name??'Business',M,40,content-235,fitBlock(doc,seller.business_name??'Business',content-235,32,19),ink,true);
      text(doc,dark?'COURSE INVOICE':'TAX INVOICE',W-M-235,40,235,18,ink,true,'right');
      text(doc,`Invoice ${header.invoice_number??'DRAFT'}${continued?' · continued':''}`,M,76,content,10,muted);
      text(doc,`Issued ${date(header.invoice_date)}${header.due_date?'  |  Due '+date(header.due_date):''}  |  Revision ${header.current_revision_no||header.revision_no||1}`,M,94,content,9,muted);
      doc.strokeColor(border).lineWidth(.7).moveTo(M,117).lineTo(W-M,117).stroke();
    }
    canvas();
    const col=(content-24)/2,partyY=135;
    const sold=[address(seller.address),seller.gstin?'GSTIN: '+seller.gstin:'',seller.contact_email??'',seller.contact_mobile??''].filter(Boolean).join('\n');
    const billed=[customer.name??'',address(customer.address),customer.email??'',customer.phone??'',customer.gstin?'GSTIN: '+customer.gstin:''].filter(Boolean).join('\n');
    text(doc,'FROM',M,partyY,col,9,muted,true);text(doc,'BILL TO',M+col+24,partyY,col,9,muted,true,udemy?'right':'left');
    text(doc,sold,M,partyY+20,col,9,ink);text(doc,billed,M+col+24,partyY+20,col,9,ink,false,udemy?'right':'left');
    let y=partyY+25+Math.max(height(doc,sold,col,9),height(doc,billed,col,9))+18;
    const extra=[options.order_reference?'Order reference: '+options.order_reference:'',options.place_of_supply?'Place of supply: '+options.place_of_supply:'',options.shipping_address?'Ship to: '+options.shipping_address:'',options.service_start||options.service_end?`Service period: ${date(options.service_start)} to ${date(options.service_end)}`:''].filter(Boolean).join('\n');
    if(extra){text(doc,extra,M,y,content,9,muted);y+=height(doc,extra,content,9)+18;}
    const widths=splitTax?[content-369,43,30,67,55,55,55,64]:dark?[28,content-28-75-42-85-80,75,42,85,80]:[24,content-24-60-32-75-70,60,32,75,70];
    const headers=splitTax?['Description','HSN','Qty','Taxable','CGST','SGST','IGST','Total']:['#',dark?'Course / Description':'Description','Unit price','Qty','Tax','Amount'];
    function tableHeader(){
      if(y>H-160){doc.addPage();canvas(true);y=135;}
      doc.rect(M,y,content,32).fill(dark?'#364255':'#edf0f3');let x=M;
      headers.forEach((label,i)=>{text(doc,label,x+6,y+10,widths[i]!-12,8,ink,true,i>=2?'right':'left');x+=widths[i]!;});y+=32;
    }
    tableHeader();
    for(let index=0;index<lines.length;index++){
      const line=lines[index],description=`${line.description??''}${line.hsn_sac?'\nHSN / SAC: '+line.hsn_sac:''}${line.unit?'\nUnit: '+line.unit:''}`;
      const taxNames=(line.tax_components??[]).map((c:any)=>`${c.name} ${c.rate}%`).join('\n');
      const rowDescription=splitTax?String(line.description??''):description;
      const rowHeight=Math.max(52,height(doc,rowDescription,widths[splitTax?0:1]!-12,9)+18,splitTax?0:height(doc,taxNames,widths[4]!-12,8)+32);
      if(y+rowHeight>H-85){doc.addPage();canvas(true);y=135;tableHeader();}
      doc.strokeColor(border).lineWidth(.4).moveTo(M,y+rowHeight).lineTo(W-M,y+rowHeight).stroke();
      let x=M;
      const componentAmounts=(kind:string)=>{let result=0;for(const c of line.tax_components??[]){if(String(c.name).toUpperCase().includes(kind))result+=number(line.taxable_amount)*number(c.rate)/100;}return result?money(result):'—';};
      const values=splitTax?[rowDescription,String(line.hsn_sac??'—'),String(line.quantity),money(line.taxable_amount),componentAmounts('CGST'),componentAmounts('SGST'),componentAmounts('IGST'),money(line.line_total)]:[String(index+1),description,money(line.unit_price),String(line.quantity),`${taxNames}${taxNames?'\n':''}${money(line.tax_amount)}`,money(line.line_total)];
      values.forEach((value,i)=>{text(doc,value,x+6,y+10,widths[i]!-12,splitTax?8:i===4?8:9,ink,i===values.length-1,i>=2?'right':'left');x+=widths[i]!;});y+=rowHeight;
    }
    const taxes=new Map<string,number>();
    for(const line of lines){const components=line.tax_components??[];let remaining=number(line.tax_amount);components.forEach((c:any,i:number)=>{const amount=i===components.length-1?remaining:Math.round(number(line.taxable_amount)*number(c.rate))/100;remaining=Math.round((remaining-amount)*100)/100;const key=`${c.name} (${c.rate}%)`;taxes.set(key,(taxes.get(key)??0)+amount);});}
    const totals:[string,string][]=[['Subtotal',money(header.subtotal)],['Discount',money(header.discount_total)],...([...taxes.entries()].map(([label,amount])=>[label,money(amount)] as [string,string]))];
    if(taxes.size===0)totals.push(['Tax',money(header.tax_total)]);
    if(number(header.rounding_adjustment)!==0)totals.push(['Rounding',money(header.rounding_adjustment)]);
    totals.push(['TOTAL',money(header.total)]);
    const totalsHeight=totals.length*23+70;
    if(y+totalsHeight>H-78){doc.addPage();canvas(true);y=140;}
    y+=22;const totalsX=W-M-255;
    totals.forEach(([label,value],i)=>{const last=i===totals.length-1;if(last){doc.rect(totalsX-10,y-4,265,32).fill(dark?'#364255':'#edf0f3');}text(doc,label,totalsX,y,135,last?12:10,ink,last);text(doc,value,totalsX+135,y,120,last?13:10,ink,last,'right');y+=last?40:23;});
    text(doc,'Amount in words',M,y,content,9,muted,true);y+=17;const amountInWords=amountWords(header.total);text(doc,amountInWords,M,y,content,10,ink);y+=height(doc,amountInWords,content,10)+18;
    if(options.notes){
      if(y>H-130){doc.addPage();canvas(true);y=140;}
      text(doc,'NOTES',M,y,content,9,muted,true);y+=18;
      let paragraph='';
      for(const word of options.notes.split(/\s+/)){
        const next=paragraph?`${paragraph} ${word}`:word;
        if(paragraph&&height(doc,next,content,9)>H-80-y){
          text(doc,paragraph,M,y,content,9,ink);doc.addPage();canvas(true);y=140;paragraph=word;
        }else paragraph=next;
      }
      if(paragraph)text(doc,paragraph,M,y,content,9,ink);
    }
    const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.strokeColor(border).moveTo(M,H-55).lineTo(W-M,H-55).stroke();text(doc,'Computer-generated invoice · No signature required',M,H-42,content-70,8,muted);text(doc,`${i+1} / ${range.count}`,W-M-65,H-42,65,8,muted,false,'right');}
  },dark);
}

export function renderCertificatePdf(certificate:CertificateDetails,issuer:string,certificateNumber:string,invoiceNumber:string):Promise<Buffer>{
  return create(doc=>{
    const W=doc.page.width,H=doc.page.height;
    if(certificate.style==='NAMASTEDEV'){
      const navy='#0b2d46',gold='#e9b237';doc.rect(0,0,W,H).fill('#ffffff');
      doc.moveTo(0,0).lineTo(267,0).lineTo(0,344).closePath().fill(navy);
      doc.moveTo(0,305).lineTo(132,H).lineTo(0,H).closePath().fill(gold);
      doc.moveTo(237,0).lineTo(257,0).lineTo(15,338).lineTo(7,318).closePath().fill(gold);
      doc.circle(67,77,29).fill(gold);doc.circle(67,77,23).lineWidth(1).stroke('#fae4a4');
      doc.moveTo(48,100).lineTo(40,133).lineTo(62,121).lineTo(72,139).lineTo(85,100).closePath().fill(gold);
      text(doc,issuer,290,43,W-330,fit(doc,issuer,W-330,22,12),navy,true,'right');
      text(doc,'CERTIFICATE',198,147,W-238,34,'#df7840',true,'center');
      text(doc,certificate.certificate_type==='COMPLETION'?'OF COMPLETION':'OF COURSE PARTICIPATION',198,199,W-238,14,navy,true,'center');
      text(doc,'This certificate is awarded to',195,249,W-230,15,'#263844',false,'center');
      text(doc,certificate.recipient_name,174,295,W-218,fitBlock(doc,certificate.recipient_name,W-218,40,32),navy,true,'center');
      doc.moveTo(200,340).lineTo(W-65,340).lineWidth(1).stroke(navy);
      text(doc,certificate.certificate_type==='COMPLETION'?'For successfully completing the course':'For participation in the course',180,362,W-225,14,'#263844',false,'center');
      text(doc,certificate.course_name,164,397,W-208,fitBlock(doc,certificate.course_name,W-208,58,27),navy,true,'center');
      text(doc,certificate.instructor_name||issuer,200,484,240,12,navy,true,'center');doc.moveTo(215,479).lineTo(425,479).stroke(navy);text(doc,certificate.instructor_name?'Instructor':'Issued by',200,505,240,9,'#617180',false,'center');
      text(doc,date(certificate.awarded_on),510,484,250,12,navy,true,'center');doc.moveTo(525,479).lineTo(745,479).stroke(navy);text(doc,'Date of issue',510,505,250,9,'#617180',false,'center');
      text(doc,`Certificate ${certificateNumber}  |  Invoice ${invoiceNumber}`,165,H-36,W-190,8,'#617180',false,'center');
    }else{
      doc.rect(0,0,W,H).fill('#ffffff');doc.rect(0,0,W,12).fill('#7d38de');
      text(doc,issuer,48,45,W-96,fit(doc,issuer,W-96,24,12),'#21232b',true);
      text(doc,certificate.certificate_type==='COMPLETION'?'CERTIFICATE OF COMPLETION':'CERTIFICATE OF COURSE PARTICIPATION',48,114,W-96,12,'#727781',true);
      const titleSize=fitBlock(doc,certificate.course_name,W-110,100,45);text(doc,certificate.course_name,48,160,W-110,titleSize,'#21232b',true);
      const courseHeight=height(doc,certificate.course_name,W-110,titleSize);
      text(doc,certificate.certificate_type==='COMPLETION'?'This certifies successful completion of the course.':'This certifies participation in the course.',48,180+courseHeight,W-110,13,'#626772');
      if(certificate.instructor_name)text(doc,`Instructor: ${certificate.instructor_name}`,48,212+courseHeight,W-110,12,'#626772');
      doc.rect(48,335,70,4).fill('#7d38de');
      text(doc,certificate.recipient_name,48,371,W-96,fitBlock(doc,certificate.recipient_name,W-96,50,32),'#21232b',true);
      text(doc,`Issued ${date(certificate.awarded_on)}`,48,432,W-96,13,'#626772');
      text(doc,`Certificate ID: ${certificateNumber}\nRelated invoice: ${invoiceNumber}`,48,H-89,W-96,10,'#626772');
    }
  },true);
}
