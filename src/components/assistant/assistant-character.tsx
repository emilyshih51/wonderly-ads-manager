'use client';

import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

/** Logical animation states (used by the overlay wrapper for CSS animations). */
export type AnimationState = 'idle' | 'wave' | 'talk' | 'think' | 'celebrate';

function CharacterModel() {
  const bob = useRef<THREE.Group>(null);
  const { scene } = useGLTF('/models/assistant.glb');

  // Gentle floating bob
  useFrame((state) => {
    if (bob.current) {
      bob.current.position.y = Math.sin(state.clock.elapsedTime * 1.5) * 0.06;
    }
  });

  return (
    <group ref={bob}>
      {/* Model is ~2.4 units tall centered near origin — scale to fit camera fov=50 z=3 */}
      <primitive object={scene} scale={1.2} position={[0, -1.4, 0]} />
    </group>
  );
}

useGLTF.preload('/models/assistant.glb');

interface AssistantCharacterProps {
  animationState: AnimationState;
}

/**
 * Renders the Shiba 3D model in a transparent R3F canvas.
 * Must be dynamically imported with `ssr: false`.
 *
 * @param animationState - Drives CSS animations on the overlay wrapper.
 */
export function AssistantCharacter({ animationState: _ }: AssistantCharacterProps) {
  return (
    <Canvas
      gl={{ alpha: true }}
      camera={{ position: [0, 0, 3.5], fov: 60 }}
      style={{ background: 'transparent', width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.6} />
      {/* Key light — warm from front-left */}
      <directionalLight position={[-2, 3, 4]} intensity={1.4} color="#fff5e0" />
      {/* Fill light — cool from right */}
      <directionalLight position={[3, 1, 1]} intensity={0.5} color="#c8d8ff" />
      {/* Rim light — blue from behind */}
      <directionalLight position={[0, 3, -5]} intensity={1.0} color="#5599ff" />
      <CharacterModel />
    </Canvas>
  );
}
