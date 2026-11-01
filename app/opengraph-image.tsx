import { ImageResponse } from 'next/og';
export const alt='NexaFile — Your private document workspace';
export const size={width:1200,height:630};
export const contentType='image/png';
export default function Image(){
  return new ImageResponse(<div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',justifyContent:'center',padding:'90px',background:'#f3f7f9',color:'#193a47',fontFamily:'sans-serif'}}><div style={{display:'flex',fontSize:34,color:'#007a71',marginBottom:40}}>NexaFile</div><div style={{display:'flex',fontSize:74,fontWeight:700,lineHeight:1.12}}>Your files.<br/>One clear workspace.</div><div style={{display:'flex',fontSize:28,color:'#496575',marginTop:40}}>Organize · Share · Search</div></div>,size);
}
