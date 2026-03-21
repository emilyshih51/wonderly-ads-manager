'use client';

import { useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';

/** Logical animation states (used by the overlay wrapper for CSS animations). */
export type AnimationState = 'idle' | 'wave' | 'talk' | 'think' | 'celebrate';

function CharacterModel() {
  const bob = useRef<THREE.Group>(null);
  const glowLight = useRef<THREE.PointLight>(null);
  const elapsed = useRef(0);
  const { scene, animations } = useGLTF('/models/assistant.glb');
  const { actions } = useAnimations(animations, bob);

  // Play embedded animation on mount
  useEffect(() => {
    const action = actions['Scene'];

    if (action) {
      action.reset().fadeIn(0.3).play();
    }
  }, [actions]);

  // Gentle floating bob + pulsing glow
  useFrame((_state, delta) => {
    elapsed.current += delta;

    if (bob.current) {
      bob.current.position.y = Math.sin(elapsed.current * 1.5) * 0.06;
    }

    if (glowLight.current) {
      glowLight.current.intensity = 1.5 + Math.sin(elapsed.current * 2) * 0.5;
    }
  });

  return (
    <group ref={bob}>
      <primitive object={scene} scale={2.8} position={[0, -1.6, 0]} />
      {/* Pulsing glow light beneath the robot */}
      <pointLight
        ref={glowLight}
        position={[0, -1.8, 0.5]}
        color="#60a5fa"
        intensity={1.5}
        distance={4}
      />
    </group>
  );
}

useGLTF.preload('/models/assistant.glb');

interface AssistantCharacterProps {
  animationState: AnimationState;
}

/**
 * Renders the robot 3D model in a transparent R3F canvas.
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
