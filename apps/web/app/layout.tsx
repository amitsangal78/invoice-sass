import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Invoice workspace',description:'Internal invoice and collections pilot. Test money only.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
