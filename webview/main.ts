import './styles/tokens.css';
import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('root');
if (!target) throw new Error('#root missing');

mount(App, { target });
