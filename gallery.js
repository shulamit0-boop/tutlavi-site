/* ============================================================
   Infinite auto-scrolling WebGL gallery
   Adapted from Codrops "Infinite Auto-Scrolling Gallery"
   (Luis Henrique Bizarro, MIT) — https://github.com/lhbizarro/infinite-webl-gallery
   Scoped to the .gal-wall band instead of the whole window:
   auto-scrolls, page scrolling adds velocity + bend, mouse-drag scrubs.
   If OGL/WebGL is unavailable this module dies quietly and the
   plain scattered DOM gallery stays visible as a fallback.
   ============================================================ */

import { Renderer, Camera, Transform, Plane, Mesh, Program, Texture } from 'https://esm.sh/ogl@1.0.11';

const lerp = (a, b, t) => a + (b - a) * t;

const VERTEX = /* glsl */ `
  #define PI 3.1415926535897932384626433832795
  precision highp float;
  attribute vec3 position;
  attribute vec2 uv;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uStrength;
  uniform vec2 uViewportSizes;
  varying vec2 vUv;
  void main() {
    vec4 newPosition = modelViewMatrix * vec4(position, 1.0);
    newPosition.z += sin(newPosition.y / uViewportSizes.y * PI + PI / 2.0) * -uStrength;
    vUv = uv;
    gl_Position = projectionMatrix * newPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec2 uImageSizes;
  uniform vec2 uPlaneSizes;
  uniform sampler2D tMap;
  varying vec2 vUv;
  void main() {
    vec2 ratio = vec2(
      min((uPlaneSizes.x / uPlaneSizes.y) / (uImageSizes.x / uImageSizes.y), 1.0),
      min((uPlaneSizes.y / uPlaneSizes.x) / (uImageSizes.y / uImageSizes.x), 1.0)
    );
    vec2 uv = vec2(
      vUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
      vUv.y * ratio.y + (1.0 - ratio.y) * 0.5
    );
    gl_FragColor.rgb = texture2D(tMap, uv).rgb;
    gl_FragColor.a = 1.0;
  }
`;

class Media {
  constructor({ element, geometry, gl, height, scene, screen, viewport }) {
    this.element = element;
    this.image = element.querySelector('img');
    this.video = element.querySelector('video');
    this.extra = 0;
    this.height = height;
    this.geometry = geometry;
    this.gl = gl;
    this.scene = scene;
    this.screen = screen;
    this.viewport = viewport;

    this.createMesh();
    this.createBounds();
    this.onResize();
  }

  createMesh() {
    this.texture = new Texture(this.gl, { generateMipmaps: false });

    const program = new Program(this.gl, {
      fragment: FRAGMENT,
      vertex: VERTEX,
      uniforms: {
        tMap: { value: this.texture },
        uPlaneSizes: { value: [0, 0] },
        uImageSizes: { value: [0, 0] },
        uViewportSizes: { value: [this.viewport.width, this.viewport.height] },
        uStrength: { value: 0 },
      },
      transparent: true,
    });
    this.program = program;

    if (this.video) {
      this.videoReady = false;
    } else if (this.image) {
      const img = new Image();
      img.src = this.image.currentSrc || this.image.src;
      img.onload = () => {
        program.uniforms.uImageSizes.value = [img.naturalWidth, img.naturalHeight];
        this.texture.image = img;
      };
    }

    this.plane = new Mesh(this.gl, { geometry: this.geometry, program });
    this.plane.setParent(this.scene);
  }

  // offset* coords are relative to the strip, so page scrolling never shifts them
  createBounds() {
    this.bounds = {
      left: this.element.offsetLeft,
      top: this.element.offsetTop,
      width: this.element.offsetWidth,
      height: this.element.offsetHeight,
    };
    this.updateScale();
    this.updateX();
    this.updateY();
    this.plane.program.uniforms.uPlaneSizes.value = [this.plane.scale.x, this.plane.scale.y];
  }

  updateScale() {
    this.plane.scale.x = this.viewport.width * this.bounds.width / this.screen.width;
    this.plane.scale.y = this.viewport.height * this.bounds.height / this.screen.height;
  }

  updateX(x = 0) {
    this.plane.position.x = -(this.viewport.width / 2) + (this.plane.scale.x / 2) +
      ((this.bounds.left - x) / this.screen.width) * this.viewport.width;
  }

  updateY(y = 0) {
    this.plane.position.y = ((this.viewport.height / 2) - (this.plane.scale.y / 2) -
      ((this.bounds.top - y) / this.screen.height) * this.viewport.height) - this.extra;
  }

  update(y, direction) {
    this.updateY(y.current);

    if (this.video && this.video.readyState >= 2) {
      if (!this.videoReady) {
        this.videoReady = true;
        this.program.uniforms.uImageSizes.value = [this.video.videoWidth, this.video.videoHeight];
      }
      this.texture.image = this.video;
      this.texture.needsUpdate = true;
    }

    const planeOffset = this.plane.scale.y / 2;
    const viewportOffset = this.viewport.height / 2;

    this.isBefore = this.plane.position.y + planeOffset < -viewportOffset;
    this.isAfter = this.plane.position.y - planeOffset > viewportOffset;

    if (direction === 'up' && this.isBefore) {
      this.extra -= this.height;
      this.isBefore = this.isAfter = false;
    }
    if (direction === 'down' && this.isAfter) {
      this.extra += this.height;
      this.isBefore = this.isAfter = false;
    }

    this.plane.program.uniforms.uStrength.value = ((y.current - y.last) / this.screen.width) * 10;
  }

  onResize(sizes) {
    this.extra = 0;
    if (sizes) {
      const { height, screen, viewport } = sizes;
      if (height) this.height = height;
      if (screen) this.screen = screen;
      if (viewport) {
        this.viewport = viewport;
        this.plane.program.uniforms.uViewportSizes.value = [this.viewport.width, this.viewport.height];
      }
    }
    this.createBounds();
  }
}

class GalleryGL {
  constructor(wall) {
    this.wall = wall;
    this.strip = wall.querySelector('.gal-strip');

    this.scroll = { ease: 0.05, current: 0, target: 0, last: 0, position: 0 };
    this.speed = 2;
    this.direction = 'down';
    this.lastPageY = window.scrollY;
    this.visible = true;

    this.createRenderer();
    if (!this.gl) throw new Error('no webgl');

    this.createCamera();
    this.scene = new Transform();

    this.onResize();
    this.planeGeometry = new Plane(this.gl, { heightSegments: 10 });
    this.createMedias();

    this.wall.classList.add('gl-on');
    this.addEventListeners();
    this.update = this.update.bind(this);
    requestAnimationFrame(this.update);
  }

  createRenderer() {
    this.renderer = new Renderer({ alpha: true, dpr: Math.min(window.devicePixelRatio || 1, 2) });
    this.gl = this.renderer.gl;
    this.gl.canvas.className = 'gal-canvas';
    this.wall.appendChild(this.gl.canvas);
  }

  createCamera() {
    this.camera = new Camera(this.gl);
    this.camera.fov = 45;
    this.camera.position.z = 5;
  }

  createMedias() {
    this.medias = [...this.wall.querySelectorAll('.gal-item')].map(element => new Media({
      element,
      geometry: this.planeGeometry,
      gl: this.gl,
      height: this.galleryHeight,
      scene: this.scene,
      screen: this.screen,
      viewport: this.viewport,
    }));
  }

  /* drag to scrub (mouse; touch scrolls the page, which also drives the gallery) */
  onDown(e) {
    this.isDown = true;
    this.scroll.position = this.scroll.current;
    this.start = e.clientY;
  }
  onMove(e) {
    if (!this.isDown) return;
    this.scroll.target = this.scroll.position + (this.start - e.clientY) * 2;
  }
  onUp() { this.isDown = false; }

  /* page scroll feeds velocity into the strip (extra bend on fast scrolls).
     factor tuned so one pass through the pinned section ≈ one full loop */
  onPageScroll() {
    const y = window.scrollY;
    this.scroll.target += (y - this.lastPageY) * 1.1;
    this.lastPageY = y;
  }

  onResize() {
    const rect = this.wall.getBoundingClientRect();
    this.screen = { width: rect.width, height: rect.height };
    this.renderer.setSize(this.screen.width, this.screen.height);
    this.camera.perspective({ aspect: this.screen.width / this.screen.height });

    const fov = this.camera.fov * (Math.PI / 180);
    const height = 2 * Math.tan(fov / 2) * this.camera.position.z;
    this.viewport = { height, width: height * this.camera.aspect };

    this.galleryHeight = this.viewport.height * this.strip.offsetHeight / this.screen.height;

    if (this.medias) {
      this.medias.forEach(media => media.onResize({
        height: this.galleryHeight,
        screen: this.screen,
        viewport: this.viewport,
      }));
    }
  }

  update() {
    if (this.visible) {
      this.scroll.target += this.speed;
      this.scroll.current = lerp(this.scroll.current, this.scroll.target, this.scroll.ease);

      if (this.scroll.current > this.scroll.last) { this.direction = 'down'; this.speed = 2; }
      else if (this.scroll.current < this.scroll.last) { this.direction = 'up'; this.speed = -2; }

      this.medias.forEach(media => media.update(this.scroll, this.direction));
      this.renderer.render({ scene: this.scene, camera: this.camera });
      this.scroll.last = this.scroll.current;
    }
    requestAnimationFrame(this.update);
  }

  addEventListeners() {
    window.addEventListener('resize', this.onResize.bind(this));
    // the module can run before the stylesheet applies (wall measures 0) —
    // ResizeObserver re-measures as soon as the real size lands
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => this.onResize()).observe(this.wall);
    } else {
      window.addEventListener('load', this.onResize.bind(this));
    }
    window.addEventListener('scroll', this.onPageScroll.bind(this), { passive: true });

    this.wall.addEventListener('mousedown', e => { e.preventDefault(); this.onDown(e); });
    window.addEventListener('mousemove', this.onMove.bind(this));
    window.addEventListener('mouseup', this.onUp.bind(this));

    // render only while the band is on (or near) screen
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        entries.forEach(entry => { this.visible = entry.isIntersecting; });
      }, { rootMargin: '25%' }).observe(this.wall);
    }
  }
}

const wall = document.getElementById('galWall');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (wall && !reduceMotion) {
  try {
    new GalleryGL(wall);
  } catch (e) {
    /* fallback: the DOM gallery stays visible */
  }
}
