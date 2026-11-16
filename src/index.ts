/**
 * CHAOS TABLE: a social card game for Meta Quest, built on the Immersive Web SDK.
 */
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ChaosSystem } from './chaos-system.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(ChaosSystem);
});
