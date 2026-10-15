import { mount } from 'svelte';
import Gallery from './Gallery.svelte';

const target = document.getElementById('app');
if (target) mount(Gallery, { target });
