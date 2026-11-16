// The renderer uses this small subset of PDFKit's API.
declare module 'pdfkit' {
  import { Readable } from 'node:stream';
  export default class PDFDocument extends Readable {
    constructor(options: {
      size: string; layout: string; margin: number; bufferPages: boolean;
      info: { Producer: string; Creator: string };
    });
    page: { width: number; height: number };
    registerFont(name: string, path: string): this;
    font(name: string): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    text(value: string, x: number, y: number, options: {
      width: number; align: string; lineGap: number; height?: number;
    }): this;
    widthOfString(value: string): number;
    heightOfString(value: string, options: { width: number; lineGap: number }): number;
    rect(x: number, y: number, width: number, height: number): this;
    circle(x: number, y: number, radius: number): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    closePath(): this;
    fill(color: string): this;
    stroke(color?: string): this;
    strokeColor(color: string): this;
    lineWidth(width: number): this;
    addPage(): this;
    bufferedPageRange(): { start: number; count: number };
    switchToPage(index: number): this;
    end(): void;
  }
}
