// N8AO bringt keine Typen mit; nur das, was Raum.svelte braucht.
declare module 'n8ao' {
	import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
	import type { Camera, Scene } from 'three';
	export class N8AOPass extends Pass {
		constructor(scene: Scene, camera: Camera, width?: number, height?: number);
		configuration: { aoRadius: number; distanceFalloff: number; intensity: number; gammaCorrection: boolean; screenSpaceRadius: boolean; transparencyAware: boolean; [k: string]: unknown };
		setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
	}
}
