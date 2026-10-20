import { NextResponse } from 'next/server';
import { GbizinfoError, getGbizinfoReadiness, searchGbizinfo, validateGbizinfoQuery } from '@/lib/server/gbizinfo';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
let searching = false;
export async function GET() { return NextResponse.json(getGbizinfoReadiness(process.env.GBIZINFO_API_TOKEN), { headers }); }
export async function POST(request: Request) {
 const origin=request.headers.get('origin'),expectedOrigin=new URL(request.url),host=request.headers.get('host');if(host)expectedOrigin.host=host;
 if(origin&&origin!==expectedOrigin.origin)return NextResponse.json({code:'ORIGIN_DENIED',message:'このアプリの画面から検索してください。'},{status:403,headers});
 if(searching)return NextResponse.json({code:'SEARCH_BUSY',message:'別の検索が実行中です。完了後に再検索してください。'},{status:429,headers});
 try{
  const body=await request.text();if(body.length>2048)throw new GbizinfoError('INVALID_QUERY','検索条件が長すぎます。',413);
  let value:unknown;try{value=JSON.parse(body);}catch{throw new GbizinfoError('INVALID_QUERY','検索条件の形式が不正です。',400);}
  const query=validateGbizinfoQuery(value);searching=true;
  try{return NextResponse.json(await searchGbizinfo(query,process.env.GBIZINFO_API_TOKEN,{signal:request.signal}),{headers});}finally{searching=false;}
 }catch(error){
  if(error instanceof GbizinfoError)return NextResponse.json({code:error.code,message:error.message,...(error.upstreamStatus?{upstreamStatus:error.upstreamStatus}:{})},{status:error.status,headers});
  // Never expose raw errors, request headers, tokens or upstream response bodies.
  return NextResponse.json({code:'SERVER_ERROR',message:'検索処理でエラーが発生しました。アプリの再起動後に再確認してください。'},{status:500,headers});
 }
}
