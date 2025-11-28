import React from 'react';

interface Props {
  iconGrid: string[];
  themeColor: string;
  isSyncing: boolean;
}

export const YotoDisplay: React.FC<Props> = ({ iconGrid, themeColor, isSyncing }) => {
  return (
    <div className="relative w-full aspect-square bg-gray-900 rounded-[15%] p-[8%] shadow-xl border-4 border-gray-800 flex items-center justify-center">
      {/* The Pixel Matrix */}
      <div 
        className="grid grid-cols-16 grid-rows-16 gap-px w-full h-full bg-black border-[3px] border-black rounded-sm overflow-hidden relative"
        style={{ boxShadow: `0 0 20px ${themeColor}40` }}
      >
        {isSyncing ? (
           <div className="absolute inset-0 flex items-center justify-center">
             <div className="w-full h-[5%] bg-gray-800 overflow-hidden">
                <div className="h-full bg-yoto-orange animate-progress"></div>
             </div>
           </div>
        ) : (
          iconGrid.map((color, i) => (
            <div 
              key={i} 
              style={{ backgroundColor: color }}
              className="w-full h-full"
            />
          ))
        )}
      </div>

      {/* Glossy overlay reflection */}
      <div className="absolute inset-0 rounded-[15%] bg-gradient-to-tr from-white/5 to-transparent pointer-events-none" />
      
      {/* Buttons representation (purely visual) */}
      <div className="absolute -right-[5%] top-[20%] w-[3%] h-[25%] bg-yoto-orange rounded-r-sm shadow-md" />
      <div className="absolute -left-[5%] top-[20%] w-[3%] h-[25%] bg-yoto-orange rounded-l-sm shadow-md" />
    </div>
  );
};