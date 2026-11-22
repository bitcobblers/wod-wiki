import { Volume2, VolumeX } from 'lucide-react';
import { Button } from "@bitcobblers/wod-wiki-ui/primitives";
import { useAudio } from '@/contexts/AudioContext';

export function AudioToggle() {
    const { isEnabled, toggleAudio } = useAudio();

    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={toggleAudio}
            className="h-11 w-11 min-h-11 min-w-11 text-muted-foreground hover:text-foreground"
            title={isEnabled ? "Mute audio" : "Enable audio"}
        >
            {isEnabled ? (
                <Volume2 className="h-[1.2rem] w-[1.2rem]" />
            ) : (
                <VolumeX className="h-[1.2rem] w-[1.2rem]" />
            )}
            <span className="sr-only">Toggle audio</span>
        </Button>
    );
}
