'use client';

import { useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';

/** Logical animation states the character can be in. */
export type AnimationState = 'idle' | 'wave' | 'talk' | 'think' | 'celebrate';

/**
 * Maps logical states to preferred Shiba Inu clip names.
 * Falls back to 'Idle' if the clip isn't found.
 * Model: Quaternius Shiba Inu (CC0) — clips: Idle, Idle_2, Idle_2_HeadLow, Walk, Eating, Gallop, Attack, Death.
 */
const CLIP_NAME: Record<AnimationState, string> = {
  idle: 'Idle',
  think: 'Idle_2_HeadLow',
  wave: 'Idle_2',
  celebrate: 'Gallop',
  talk: 'Eating',
};

interface CharacterModelProps {
  animationState: AnimationState;
}

function CharacterModel({ animationState }: CharacterModelProps) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF('/models/assistant.glb');
  const { actions, names } = useAnimations(animations, group);

  useEffect(() => {
    if (names.length === 0) return;

    // Prefer exact clip name, fall back to first clip
    const targetName = names.includes(CLIP_NAME[animationState])
      ? CLIP_NAME[animationState]
      : (names[0] ?? '');
    if (!targetName) return;

    const next = actions[targetName];
    if (!next) return;

    // Crossfade from whatever is currently playing
    const current = Object.values(actions).find((a) => a?.isRunning());
    if (current && current !== next) {
      next.reset().play();
      current.crossFadeTo(next, 0.3, true);
    } else if (!next.isRunning()) {
      next.reset().play();
    }
  }, [animationState, actions, names]);

  // Gentle floating bob
  useFrame((state) => {
    if (group.current) {
      group.current.position.y = Math.sin(state.clock.elapsedTime * 1.5) * 0.05;
    }
  });

  return <primitive ref={group} object={scene} scale={1.8} position={[0, -0.6, 0]} />;
}

// Preload the model so it's ready before the overlay mounts
useGLTF.preload('/models/assistant.glb');

interface AssistantCharacterProps {
  animationState: AnimationState;
}

/**
 * Renders a 3D GLB character in a transparent R3F canvas.
 * Must be dynamically imported with `ssr: false` — Three.js requires a browser environment.
 *
 * @param animationState - The current logical animation state for the character.
 */
export function AssistantCharacter({ animationState }: AssistantCharacterProps) {
  return (
    <Canvas
      gl={{ alpha: true }}
      camera={{ position: [0, 0.5, 3.5], fov: 45 }}
      style={{ background: 'transparent', width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[2, 4, 2]} intensity={1} />
      <CharacterModel animationState={animationState} />
    </Canvas>
  );
}
