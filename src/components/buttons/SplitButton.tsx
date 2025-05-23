import React from "react";
import { Menu } from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/24/solid";
import { IActionButton } from "@/core/IActionButton";
import { IRuntimeEvent } from "@/core/IRuntimeEvent";

export interface SplitButtonOption {
  id: string;
  label: string;
  onClick: () => IRuntimeEvent[];
}

interface SplitButtonProps {
  mainAction: IActionButton;
  options: SplitButtonOption[];
  setEvents: React.Dispatch<React.SetStateAction<IRuntimeEvent[]>>;
  variant?: 'default' | 'success';
}

export const SplitButton: React.FC<SplitButtonProps> = ({
  mainAction,
  options = [],
  setEvents,
  variant = 'default'
}) => {
  const handleMainAction = () => {
    const events = mainAction.onClick();
    setEvents(events);
  };

  const handleOptionClick = (option: SplitButtonOption) => {
    const events = option.onClick();
    setEvents(events);
  };

  const getMainButtonStyle = () => {
    const baseStyle = "flex items-center px-3 py-1 rounded-l-full transition-all border ";
    
    if (variant === 'success') {
      return baseStyle + "bg-green-600 text-white hover:bg-green-700 border-green-600";
    }
    
    if (mainAction.isActive) {
      return baseStyle + "bg-blue-600 text-white border-blue-600";
    }
    
    return baseStyle + "bg-white text-blue-600 hover:bg-blue-50 border-blue-200";
  };

  const getDropdownButtonStyle = () => {
    const baseStyle = "flex items-center px-2 py-1 rounded-r-full transition-all border ";
    
    if (variant === 'success') {
      return baseStyle + "bg-green-600 text-white hover:bg-green-700 border-green-600 border-l-green-700";
    }
    
    if (mainAction.isActive) {
      return baseStyle + "bg-blue-600 text-white border-blue-600 border-l-blue-700";
    }
    
    return baseStyle + "bg-white text-blue-600 hover:bg-blue-50 border-blue-200";
  };

  const getMenuItemStyle = (active: boolean) => {
    return `${
      active ? "bg-blue-100 text-blue-800" : "text-gray-700"
    } group flex w-full items-center px-4 py-2 text-sm`;
  };

  return (
    <div className="flex -space-x-px">
      {/* Main button */}
      <button
        onClick={handleMainAction}
        className={getMainButtonStyle()}
      >
        {mainAction.label && <span className="mr-2">{mainAction.label}</span>}
        {mainAction.icon && <mainAction.icon className="w-4 h-4" />}
      </button>
      
      {/* Dropdown part */}
      <Menu as="div" className="relative inline-block text-left">
        <Menu.Button className={getDropdownButtonStyle()}>
          <ChevronDownIcon className="w-4 h-4 my-1" />
        </Menu.Button>
        
        <Menu.Items className="absolute right-0 mt-1 w-48 origin-top-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-10">
          <div className="p-1">
            {options.map((option) => (
              <Menu.Item key={option.id}>
                {({ active }) => (
                  <button
                    className={getMenuItemStyle(active)}
                    onClick={() => handleOptionClick(option)}
                  >
                    {option.label}
                  </button>
                )}
              </Menu.Item>
            ))}
          </div>
        </Menu.Items>
      </Menu>
    </div>
  );
};
