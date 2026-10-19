import React from 'react';
export const A = (p: { v: unknown }) => <div>{(p.v as any).x}</div>;
export const B = ({ d }: { d: unknown }) => <span>{d as unknown as string}</span>;
