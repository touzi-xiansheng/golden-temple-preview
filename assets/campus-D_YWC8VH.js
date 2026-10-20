import{a as e,i as t,n,t as r}from"./three.module-By_ZExND.js";import"./modulepreload-polyfill-P2Xu9kJm.js";import{$ as i,$r as a,Ar as o,Bt as s,Dr as c,E as l,Fa as u,Fi as d,G as f,Hn as p,Ht as m,O as h,Qa as g,Qi as _,Qt as v,Rn as y,Rt as b,St as x,U as S,Wn as C,Wr as w,Xt as T,Yt as E,_r as D,ar as O,bt as k,co as A,do as j,ea as ee,io as M,ir as N,jr as P,kr as te,mr as F,no as I,or as L,qa as R,ro as z,rr as ne,sn as B,sr as re,ta as V,tr as H,ut as U,wr as W}from"./three.core-DuvWXBVy.js";import{c as ie}from"./geom-C12jUWl1.js";import{n as ae}from"./sky-CE_hpqjI.js";import{n as G,t as K}from"./Pass-CXM1VNzz.js";import{a as oe,c as se,d as ce,f as le,i as ue,l as de,m as fe,n as pe,o as me,p as he,r as q,s as ge,t as _e,u as ve}from"./LightProbeGridUtils-CTAn8m6g.js";var ye={name:`CopyShader`,uniforms:{tDiffuse:{value:null},opacity:{value:1}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform float opacity;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );
			gl_FragColor = opacity * texel;


		}`},be=class extends G{constructor(e,t=`tDiffuse`){super(),this.textureID=t,this.uniforms=null,this.material=null,e instanceof V?(this.uniforms=e.uniforms,this.material=e):e&&(this.uniforms=R.clone(e.uniforms),this.material=new V({name:e.name===void 0?`unspecified`:e.name,defines:Object.assign({},e.defines),uniforms:this.uniforms,vertexShader:e.vertexShader,fragmentShader:e.fragmentShader})),this._fsQuad=new K(this.material)}render(e,t,n){this.uniforms[this.textureID]&&(this.uniforms[this.textureID].value=n.texture),this._fsQuad.material=this.material,this.renderToScreen?(e.setRenderTarget(null),this._fsQuad.render(e)):(e.setRenderTarget(t),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this._fsQuad.render(e))}dispose(){this.material.dispose(),this._fsQuad.dispose()}},xe=class extends G{constructor(e,t){super(),this.scene=e,this.camera=t,this.clear=!0,this.needsSwap=!1,this.inverse=!1}render(e,t,n){let r=e.getContext(),i=e.state;i.buffers.color.setMask(!1),i.buffers.depth.setMask(!1),i.buffers.color.setLocked(!0),i.buffers.depth.setLocked(!0);let a,o;this.inverse?(a=0,o=1):(a=1,o=0),i.buffers.stencil.setTest(!0),i.buffers.stencil.setOp(r.REPLACE,r.REPLACE,r.REPLACE),i.buffers.stencil.setFunc(r.ALWAYS,a,4294967295),i.buffers.stencil.setClear(o),i.buffers.stencil.setLocked(!0),e.setRenderTarget(n),this.clear&&e.clear(),e.render(this.scene,this.camera),e.setRenderTarget(t),this.clear&&e.clear(),e.render(this.scene,this.camera),i.buffers.color.setLocked(!1),i.buffers.depth.setLocked(!1),i.buffers.color.setMask(!0),i.buffers.depth.setMask(!0),i.buffers.stencil.setLocked(!1),i.buffers.stencil.setFunc(r.EQUAL,1,4294967295),i.buffers.stencil.setOp(r.KEEP,r.KEEP,r.KEEP),i.buffers.stencil.setLocked(!0)}},Se=class extends G{constructor(){super(),this.needsSwap=!1}render(e){e.state.buffers.stencil.setLocked(!1),e.state.buffers.stencil.setTest(!1)}},Ce=class{constructor(e,t){if(this.renderer=e,this._pixelRatio=e.getPixelRatio(),t===void 0){let n=e.getSize(new I);this._width=n.width,this._height=n.height,t=new j(this._width*this._pixelRatio,this._height*this._pixelRatio,{type:E}),t.texture.name=`EffectComposer.rt1`}else this._width=t.width,this._height=t.height;this.renderTarget1=t,this.renderTarget2=t.clone(),this.renderTarget2.texture.name=`EffectComposer.rt2`,this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2,this.renderToScreen=!0,this.passes=[],this.copyPass=new be(ye),this.copyPass.material.blending=0,this.timer=new u}swapBuffers(){let e=this.readBuffer;this.readBuffer=this.writeBuffer,this.writeBuffer=e}addPass(e){this.passes.push(e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}insertPass(e,t){this.passes.splice(t,0,e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}removePass(e){let t=this.passes.indexOf(e);t!==-1&&this.passes.splice(t,1)}isLastEnabledPass(e){for(let t=e+1;t<this.passes.length;t++)if(this.passes[t].enabled)return!1;return!0}render(e){this.timer.update(),e===void 0&&(e=this.timer.getDelta());let t=this.renderer.getRenderTarget(),n=!1;for(let t=0,r=this.passes.length;t<r;t++){let r=this.passes[t];if(r.enabled!==!1){if(r.renderToScreen=this.renderToScreen&&this.isLastEnabledPass(t),r.render(this.renderer,this.writeBuffer,this.readBuffer,e,n),r.needsSwap){if(n){let t=this.renderer.getContext(),n=this.renderer.state.buffers.stencil;n.setFunc(t.NOTEQUAL,1,4294967295),this.copyPass.render(this.renderer,this.writeBuffer,this.readBuffer,e),n.setFunc(t.EQUAL,1,4294967295)}this.swapBuffers()}xe!==void 0&&(r instanceof xe?n=!0:r instanceof Se&&(n=!1))}}this.renderer.setRenderTarget(t)}reset(e){if(e===void 0){let t=this.renderer.getSize(new I);this._pixelRatio=this.renderer.getPixelRatio(),this._width=t.width,this._height=t.height,e=this.renderTarget1.clone(),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.renderTarget1=e,this.renderTarget2=e.clone(),this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2}setSize(e,t){this._width=e,this._height=t;let n=this._width*this._pixelRatio,r=this._height*this._pixelRatio;this.renderTarget1.setSize(n,r),this.renderTarget2.setSize(n,r);for(let e=0;e<this.passes.length;e++)this.passes[e].setSize(n,r)}setPixelRatio(e){this._pixelRatio=e,this.setSize(this._width,this._height)}dispose(){this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.copyPass.dispose()}},we=class extends G{constructor(e,t,n=null,r=null,i=null){super(),this.scene=e,this.camera=t,this.overrideMaterial=n,this.clearColor=r,this.clearAlpha=i,this.clear=!0,this.clearDepth=!1,this.needsSwap=!1,this.isRenderPass=!0,this._oldClearColor=new S}render(e,t,n){let r=e.autoClear;e.autoClear=!1;let i,a;this.overrideMaterial!==null&&(a=this.scene.overrideMaterial,this.scene.overrideMaterial=this.overrideMaterial),this.clearColor!==null&&(e.getClearColor(this._oldClearColor),e.setClearColor(this.clearColor,e.getClearAlpha())),this.clearAlpha!==null&&(i=e.getClearAlpha(),e.setClearAlpha(this.clearAlpha)),this.clearDepth==1&&e.clearDepth(),e.setRenderTarget(this.renderToScreen?null:n),this.clear===!0&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),e.render(this.scene,this.camera),this.clearColor!==null&&e.setClearColor(this._oldClearColor),this.clearAlpha!==null&&e.setClearAlpha(i),this.overrideMaterial!==null&&(this.scene.overrideMaterial=a),e.autoClear=r}},Te={name:`LuminosityHighPassShader`,uniforms:{tDiffuse:{value:null},luminosityThreshold:{value:1},smoothWidth:{value:1},defaultColor:{value:new S(0)},defaultOpacity:{value:0}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform sampler2D tDiffuse;
		uniform vec3 defaultColor;
		uniform float defaultOpacity;
		uniform float luminosityThreshold;
		uniform float smoothWidth;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );

			float v = luminance( texel.xyz );

			vec4 outputColor = vec4( defaultColor.rgb, defaultOpacity );

			float alpha = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v );

			gl_FragColor = mix( outputColor, texel, alpha );

		}`},Ee=class e extends G{constructor(e,t=1,n,r){super(),this.strength=t,this.radius=n,this.threshold=r,this.resolution=e===void 0?new I(256,256):new I(e.x,e.y),this.clearColor=new S(0,0,0),this.needsSwap=!1,this.renderTargetsHorizontal=[],this.renderTargetsVertical=[],this.nMips=5;let i=Math.round(this.resolution.x/2),a=Math.round(this.resolution.y/2);this.renderTargetBright=new j(i,a,{type:E,depthBuffer:!1}),this.renderTargetBright.texture.name=`UnrealBloomPass.bright`,this.renderTargetBright.texture.generateMipmaps=!1;for(let e=0;e<this.nMips;e++){let t=new j(i,a,{type:E,depthBuffer:!1});t.texture.name=`UnrealBloomPass.h`+e,t.texture.generateMipmaps=!1,this.renderTargetsHorizontal.push(t);let n=new j(i,a,{type:E,depthBuffer:!1});n.texture.name=`UnrealBloomPass.v`+e,n.texture.generateMipmaps=!1,this.renderTargetsVertical.push(n),i=Math.round(i/2),a=Math.round(a/2)}let o=Te;this.highPassUniforms=R.clone(o.uniforms),this.highPassUniforms.luminosityThreshold.value=r,this.highPassUniforms.smoothWidth.value=.01,this.materialHighPassFilter=new V({uniforms:this.highPassUniforms,vertexShader:o.vertexShader,fragmentShader:o.fragmentShader}),this.separableBlurMaterials=[];let s=[6,10,14,18,22];i=Math.round(this.resolution.x/2),a=Math.round(this.resolution.y/2);for(let e=0;e<this.nMips;e++)this.separableBlurMaterials.push(this._getSeparableBlurMaterial(s[e])),this.separableBlurMaterials[e].uniforms.invSize.value=new I(1/i,1/a),i=Math.round(i/2),a=Math.round(a/2);this.compositeMaterial=this._getCompositeMaterial(this.nMips),this.compositeMaterial.uniforms.blurTexture1.value=this.renderTargetsVertical[0].texture,this.compositeMaterial.uniforms.blurTexture2.value=this.renderTargetsVertical[1].texture,this.compositeMaterial.uniforms.blurTexture3.value=this.renderTargetsVertical[2].texture,this.compositeMaterial.uniforms.blurTexture4.value=this.renderTargetsVertical[3].texture,this.compositeMaterial.uniforms.blurTexture5.value=this.renderTargetsVertical[4].texture,this.compositeMaterial.uniforms.bloomStrength.value=t,this.compositeMaterial.uniforms.bloomRadius.value=.1;let c=[1,.8,.6,.4,.2];this.compositeMaterial.uniforms.bloomFactors.value=c,this.bloomTintColors=[new z(1,1,1),new z(1,1,1),new z(1,1,1),new z(1,1,1),new z(1,1,1)],this.compositeMaterial.uniforms.bloomTintColors.value=this.bloomTintColors,this.copyUniforms=R.clone(ye.uniforms),this.blendMaterial=new V({uniforms:this.copyUniforms,vertexShader:ye.vertexShader,fragmentShader:ye.fragmentShader,premultipliedAlpha:!0,blending:2,depthTest:!1,depthWrite:!1,transparent:!0}),this._oldClearColor=new S,this._oldClearAlpha=1,this._basic=new L,this._fsQuad=new K(null)}dispose(){for(let e=0;e<this.renderTargetsHorizontal.length;e++)this.renderTargetsHorizontal[e].dispose();for(let e=0;e<this.renderTargetsVertical.length;e++)this.renderTargetsVertical[e].dispose();this.renderTargetBright.dispose();for(let e=0;e<this.separableBlurMaterials.length;e++)this.separableBlurMaterials[e].dispose();this.compositeMaterial.dispose(),this.blendMaterial.dispose(),this._basic.dispose(),this._fsQuad.dispose()}setSize(e,t){let n=Math.round(e/2),r=Math.round(t/2);this.renderTargetBright.setSize(n,r);for(let e=0;e<this.nMips;e++)this.renderTargetsHorizontal[e].setSize(n,r),this.renderTargetsVertical[e].setSize(n,r),this.separableBlurMaterials[e].uniforms.invSize.value=new I(1/n,1/r),n=Math.round(n/2),r=Math.round(r/2)}render(t,n,r,i,a){t.getClearColor(this._oldClearColor),this._oldClearAlpha=t.getClearAlpha();let o=t.autoClear;t.autoClear=!1,t.setClearColor(this.clearColor,0),a&&t.state.buffers.stencil.setTest(!1),this.renderToScreen&&(this._fsQuad.material=this._basic,this._basic.map=r.texture,t.setRenderTarget(null),t.clear(),this._fsQuad.render(t)),this.highPassUniforms.tDiffuse.value=r.texture,this.highPassUniforms.luminosityThreshold.value=this.threshold,this._fsQuad.material=this.materialHighPassFilter,t.setRenderTarget(this.renderTargetBright),t.clear(),this._fsQuad.render(t);let s=this.renderTargetBright;for(let n=0;n<this.nMips;n++)this._fsQuad.material=this.separableBlurMaterials[n],this.separableBlurMaterials[n].uniforms.colorTexture.value=s.texture,this.separableBlurMaterials[n].uniforms.direction.value=e.BlurDirectionX,t.setRenderTarget(this.renderTargetsHorizontal[n]),t.clear(),this._fsQuad.render(t),this.separableBlurMaterials[n].uniforms.colorTexture.value=this.renderTargetsHorizontal[n].texture,this.separableBlurMaterials[n].uniforms.direction.value=e.BlurDirectionY,t.setRenderTarget(this.renderTargetsVertical[n]),t.clear(),this._fsQuad.render(t),s=this.renderTargetsVertical[n];this._fsQuad.material=this.compositeMaterial,this.compositeMaterial.uniforms.bloomStrength.value=this.strength,this.compositeMaterial.uniforms.bloomRadius.value=this.radius,this.compositeMaterial.uniforms.bloomTintColors.value=this.bloomTintColors,t.setRenderTarget(this.renderTargetsHorizontal[0]),t.clear(),this._fsQuad.render(t),this._fsQuad.material=this.blendMaterial,this.copyUniforms.tDiffuse.value=this.renderTargetsHorizontal[0].texture,a&&t.state.buffers.stencil.setTest(!0),this.renderToScreen?(t.setRenderTarget(null),this._fsQuad.render(t)):(t.setRenderTarget(r),this._fsQuad.render(t)),t.setClearColor(this._oldClearColor,this._oldClearAlpha),t.autoClear=o}_getSeparableBlurMaterial(e){let t=[],n=e/3;for(let r=0;r<e;r++)t.push(.39894*Math.exp(-.5*r*r/(n*n))/n);let r=[],i=[];for(let n=1;n<e;n+=2){let a=t[n],o=n+1<e?t[n+1]:0,s=a+o;r.push((n*a+(n+1)*o)/s),i.push(s)}return new V({defines:{KERNEL_PAIRS:r.length},uniforms:{colorTexture:{value:null},invSize:{value:new I(.5,.5)},direction:{value:new I(.5,.5)},centerWeight:{value:t[0]},gaussianOffsets:{value:r},gaussianWeights:{value:i}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,fragmentShader:`

				#include <common>

				varying vec2 vUv;

				uniform sampler2D colorTexture;
				uniform vec2 invSize;
				uniform vec2 direction;
				uniform float centerWeight;
				uniform float gaussianOffsets[KERNEL_PAIRS];
				uniform float gaussianWeights[KERNEL_PAIRS];

				void main() {

					vec3 diffuseSum = texture2D( colorTexture, vUv ).rgb * centerWeight;

					for ( int i = 0; i < KERNEL_PAIRS; i ++ ) {

						vec2 uvOffset = direction * invSize * gaussianOffsets[ i ];
						vec3 sample1 = texture2D( colorTexture, vUv + uvOffset ).rgb;
						vec3 sample2 = texture2D( colorTexture, vUv - uvOffset ).rgb;
						diffuseSum += ( sample1 + sample2 ) * gaussianWeights[ i ];

					}

					gl_FragColor = vec4( diffuseSum, 1.0 );

				}`})}_getCompositeMaterial(e){return new V({defines:{NUM_MIPS:e},uniforms:{blurTexture1:{value:null},blurTexture2:{value:null},blurTexture3:{value:null},blurTexture4:{value:null},blurTexture5:{value:null},bloomStrength:{value:1},bloomFactors:{value:null},bloomTintColors:{value:null},bloomRadius:{value:0}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,fragmentShader:`

				varying vec2 vUv;

				uniform sampler2D blurTexture1;
				uniform sampler2D blurTexture2;
				uniform sampler2D blurTexture3;
				uniform sampler2D blurTexture4;
				uniform sampler2D blurTexture5;
				uniform float bloomStrength;
				uniform float bloomRadius;
				uniform float bloomFactors[NUM_MIPS];
				uniform vec3 bloomTintColors[NUM_MIPS];

				float lerpBloomFactor( const in float factor ) {

					float mirrorFactor = 1.2 - factor;
					return mix( factor, mirrorFactor, bloomRadius );

				}

				void main() {

					// 3.0 for backwards compatibility with previous alpha-based intensity
					vec3 bloom = 3.0 * bloomStrength * (
						lerpBloomFactor( bloomFactors[ 0 ] ) * bloomTintColors[ 0 ] * texture2D( blurTexture1, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 1 ] ) * bloomTintColors[ 1 ] * texture2D( blurTexture2, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 2 ] ) * bloomTintColors[ 2 ] * texture2D( blurTexture3, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 3 ] ) * bloomTintColors[ 3 ] * texture2D( blurTexture4, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 4 ] ) * bloomTintColors[ 4 ] * texture2D( blurTexture5, vUv ).rgb
					);

					float bloomAlpha = max( bloom.r, max( bloom.g, bloom.b ) );
					gl_FragColor = vec4( bloom, bloomAlpha );

				}`})}};Ee.BlurDirectionX=new I(1,0),Ee.BlurDirectionY=new I(0,1);var De={name:`OutputShader`,uniforms:{tDiffuse:{value:null},toneMappingExposure:{value:1}},vertexShader:`
		precision highp float;

		uniform mat4 modelViewMatrix;
		uniform mat4 projectionMatrix;

		attribute vec3 position;
		attribute vec2 uv;

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		precision highp float;

		uniform sampler2D tDiffuse;

		#include <tonemapping_pars_fragment>
		#include <colorspace_pars_fragment>

		varying vec2 vUv;

		void main() {

			gl_FragColor = texture2D( tDiffuse, vUv );

			// tone mapping

			#ifdef LINEAR_TONE_MAPPING

				gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );

			#elif defined( REINHARD_TONE_MAPPING )

				gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );

			#elif defined( CINEON_TONE_MAPPING )

				gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );

			#elif defined( ACES_FILMIC_TONE_MAPPING )

				gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );

			#elif defined( AGX_TONE_MAPPING )

				gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );

			#elif defined( NEUTRAL_TONE_MAPPING )

				gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );

			#elif defined( CUSTOM_TONE_MAPPING )

				gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );

			#endif

			// color space

			#ifdef SRGB_TRANSFER

				gl_FragColor = sRGBTransferOETF( gl_FragColor );

			#endif

		}`},Oe=class extends G{constructor(){super(),this.isOutputPass=!0,this.uniforms=R.clone(De.uniforms),this.material=new d({name:De.name,uniforms:this.uniforms,vertexShader:De.vertexShader,fragmentShader:De.fragmentShader}),this._fsQuad=new K(this.material),this._outputColorSpace=null,this._toneMapping=null}render(e,t,n){this.uniforms.tDiffuse.value=n.texture,this.uniforms.toneMappingExposure.value=e.toneMappingExposure,(this._outputColorSpace!==e.outputColorSpace||this._toneMapping!==e.toneMapping)&&(this._outputColorSpace=e.outputColorSpace,this._toneMapping=e.toneMapping,this.material.defines={},f.getTransfer(this._outputColorSpace)===`srgb`&&(this.material.defines.SRGB_TRANSFER=``),this._toneMapping===1?this.material.defines.LINEAR_TONE_MAPPING=``:this._toneMapping===2?this.material.defines.REINHARD_TONE_MAPPING=``:this._toneMapping===3?this.material.defines.CINEON_TONE_MAPPING=``:this._toneMapping===4?this.material.defines.ACES_FILMIC_TONE_MAPPING=``:this._toneMapping===6?this.material.defines.AGX_TONE_MAPPING=``:this._toneMapping===7?this.material.defines.NEUTRAL_TONE_MAPPING=``:this._toneMapping===5&&(this.material.defines.CUSTOM_TONE_MAPPING=``),this.material.needsUpdate=!0),this.renderToScreen===!0?(e.setRenderTarget(null),this._fsQuad.render(e)):(e.setRenderTarget(t),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this._fsQuad.render(e))}dispose(){this.material.dispose(),this._fsQuad.dispose()}},ke={name:`FXAAShader`,uniforms:{tDiffuse:{value:null},resolution:{value:new I(1/1024,1/512)}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform sampler2D tDiffuse;
		uniform vec2 resolution;
		varying vec2 vUv;

		#define EDGE_STEP_COUNT 6
		#define EDGE_GUESS 8.0
		#define EDGE_STEPS 1.0, 1.5, 2.0, 2.0, 2.0, 4.0
		const float edgeSteps[EDGE_STEP_COUNT] = float[EDGE_STEP_COUNT]( EDGE_STEPS );

		float _ContrastThreshold = 0.0312;
		float _RelativeThreshold = 0.063;
		float _SubpixelBlending = 1.0;

		vec4 Sample( sampler2D  tex2D, vec2 uv ) {

			return texture( tex2D, uv );

		}

		float SampleLuminance( sampler2D tex2D, vec2 uv ) {

			return dot( Sample( tex2D, uv ).rgb, vec3( 0.3, 0.59, 0.11 ) );

		}

		float SampleLuminance( sampler2D tex2D, vec2 texSize, vec2 uv, float uOffset, float vOffset ) {

			uv += texSize * vec2(uOffset, vOffset);
			return SampleLuminance(tex2D, uv);

		}

		struct LuminanceData {

			float m, n, e, s, w;
			float ne, nw, se, sw;
			float highest, lowest, contrast;

		};

		LuminanceData SampleLuminanceNeighborhood( sampler2D tex2D, vec2 texSize, vec2 uv ) {

			LuminanceData l;
			l.m = SampleLuminance( tex2D, uv );
			l.n = SampleLuminance( tex2D, texSize, uv,  0.0,  1.0 );
			l.e = SampleLuminance( tex2D, texSize, uv,  1.0,  0.0 );
			l.s = SampleLuminance( tex2D, texSize, uv,  0.0, -1.0 );
			l.w = SampleLuminance( tex2D, texSize, uv, -1.0,  0.0 );

			l.ne = SampleLuminance( tex2D, texSize, uv,  1.0,  1.0 );
			l.nw = SampleLuminance( tex2D, texSize, uv, -1.0,  1.0 );
			l.se = SampleLuminance( tex2D, texSize, uv,  1.0, -1.0 );
			l.sw = SampleLuminance( tex2D, texSize, uv, -1.0, -1.0 );

			l.highest = max( max( max( max( l.n, l.e ), l.s ), l.w ), l.m );
			l.lowest = min( min( min( min( l.n, l.e ), l.s ), l.w ), l.m );
			l.contrast = l.highest - l.lowest;
			return l;

		}

		bool ShouldSkipPixel( LuminanceData l ) {

			float threshold = max( _ContrastThreshold, _RelativeThreshold * l.highest );
			return l.contrast < threshold;

		}

		float DeterminePixelBlendFactor( LuminanceData l ) {

			float f = 2.0 * ( l.n + l.e + l.s + l.w );
			f += l.ne + l.nw + l.se + l.sw;
			f *= 1.0 / 12.0;
			f = abs( f - l.m );
			f = clamp( f / l.contrast, 0.0, 1.0 );

			float blendFactor = smoothstep( 0.0, 1.0, f );
			return blendFactor * blendFactor * _SubpixelBlending;

		}

		struct EdgeData {

			bool isHorizontal;
			float pixelStep;
			float oppositeLuminance, gradient;

		};

		EdgeData DetermineEdge( vec2 texSize, LuminanceData l ) {

			EdgeData e;
			float horizontal =
				abs( l.n + l.s - 2.0 * l.m ) * 2.0 +
				abs( l.ne + l.se - 2.0 * l.e ) +
				abs( l.nw + l.sw - 2.0 * l.w );
			float vertical =
				abs( l.e + l.w - 2.0 * l.m ) * 2.0 +
				abs( l.ne + l.nw - 2.0 * l.n ) +
				abs( l.se + l.sw - 2.0 * l.s );
			e.isHorizontal = horizontal >= vertical;

			float pLuminance = e.isHorizontal ? l.n : l.e;
			float nLuminance = e.isHorizontal ? l.s : l.w;
			float pGradient = abs( pLuminance - l.m );
			float nGradient = abs( nLuminance - l.m );

			e.pixelStep = e.isHorizontal ? texSize.y : texSize.x;

			if (pGradient < nGradient) {

				e.pixelStep = -e.pixelStep;
				e.oppositeLuminance = nLuminance;
				e.gradient = nGradient;

			} else {

				e.oppositeLuminance = pLuminance;
				e.gradient = pGradient;

			}

			return e;

		}

		float DetermineEdgeBlendFactor( sampler2D  tex2D, vec2 texSize, LuminanceData l, EdgeData e, vec2 uv ) {

			vec2 uvEdge = uv;
			vec2 edgeStep;
			if (e.isHorizontal) {

				uvEdge.y += e.pixelStep * 0.5;
				edgeStep = vec2( texSize.x, 0.0 );

			} else {

				uvEdge.x += e.pixelStep * 0.5;
				edgeStep = vec2( 0.0, texSize.y );

			}

			float edgeLuminance = ( l.m + e.oppositeLuminance ) * 0.5;
			float gradientThreshold = e.gradient * 0.25;

			vec2 puv = uvEdge + edgeStep * edgeSteps[0];
			float pLuminanceDelta = SampleLuminance( tex2D, puv ) - edgeLuminance;
			bool pAtEnd = abs( pLuminanceDelta ) >= gradientThreshold;

			for ( int i = 1; i < EDGE_STEP_COUNT && !pAtEnd; i++ ) {

				puv += edgeStep * edgeSteps[i];
				pLuminanceDelta = SampleLuminance( tex2D, puv ) - edgeLuminance;
				pAtEnd = abs( pLuminanceDelta ) >= gradientThreshold;

			}

			if ( !pAtEnd ) {

				puv += edgeStep * EDGE_GUESS;

			}

			vec2 nuv = uvEdge - edgeStep * edgeSteps[0];
			float nLuminanceDelta = SampleLuminance( tex2D, nuv ) - edgeLuminance;
			bool nAtEnd = abs( nLuminanceDelta ) >= gradientThreshold;

			for ( int i = 1; i < EDGE_STEP_COUNT && !nAtEnd; i++ ) {

				nuv -= edgeStep * edgeSteps[i];
				nLuminanceDelta = SampleLuminance( tex2D, nuv ) - edgeLuminance;
				nAtEnd = abs( nLuminanceDelta ) >= gradientThreshold;

			}

			if ( !nAtEnd ) {

				nuv -= edgeStep * EDGE_GUESS;

			}

			float pDistance, nDistance;
			if ( e.isHorizontal ) {

				pDistance = puv.x - uv.x;
				nDistance = uv.x - nuv.x;

			} else {

				pDistance = puv.y - uv.y;
				nDistance = uv.y - nuv.y;

			}

			float shortestDistance;
			bool deltaSign;
			if ( pDistance <= nDistance ) {

				shortestDistance = pDistance;
				deltaSign = pLuminanceDelta >= 0.0;

			} else {

				shortestDistance = nDistance;
				deltaSign = nLuminanceDelta >= 0.0;

			}

			if ( deltaSign == ( l.m - edgeLuminance >= 0.0 ) ) {

				return 0.0;

			}

			return 0.5 - shortestDistance / ( pDistance + nDistance );

		}

		vec4 ApplyFXAA( sampler2D  tex2D, vec2 texSize, vec2 uv ) {

			LuminanceData luminance = SampleLuminanceNeighborhood( tex2D, texSize, uv );
			if ( ShouldSkipPixel( luminance ) ) {

				return Sample( tex2D, uv );

			}

			float pixelBlend = DeterminePixelBlendFactor( luminance );
			EdgeData edge = DetermineEdge( texSize, luminance );
			float edgeBlend = DetermineEdgeBlendFactor( tex2D, texSize, luminance, edge, uv );
			float finalBlend = max( pixelBlend, edgeBlend );

			if (edge.isHorizontal) {

				uv.y += edge.pixelStep * finalBlend;

			} else {

				uv.x += edge.pixelStep * finalBlend;

			}

			return Sample( tex2D, uv );

		}

		void main() {

			gl_FragColor = ApplyFXAA( tDiffuse, resolution.xy, vUv );

		}`},Ae=.00465,je=`
  #else // SHADOWMAP_TYPE_BASIC
    vec2 campusShadowDisk(int index, float count, float angle) {
      float r = sqrt((float(index) + 0.5) / count);
      float a = float(index) * 2.39996323 + angle;
      return vec2(cos(a), sin(a)) * r;
    }
    float campusShadowDepth(sampler2D map, vec2 uv, vec2 size, vec3 receiver, vec2 gradient) {
      // Account for the receiving plane at the exact sampled texel, instead of a large bias.
      vec2 center = (floor(uv * size) + 0.5) / size;
      float z = receiver.z + dot(gradient, center - receiver.xy);
      return z - texture2D(map, center).r;
    }
    float campusShadowTapVisibility(sampler2D map, vec2 uv, vec2 size, vec3 receiver, vec2 gradient) {
      // Interpolate comparison results at this existing PCSS tap, never depth values.
      vec2 texel = 1.0 / size, pixel = uv * size - 0.5;
      vec2 base = (floor(pixel) + 0.5) / size, f = fract(pixel);
      vec2 lo = texel * 0.5, hi = 1.0 - lo;
      // campusShadowDepth corrects the receiving plane at each clamped texel center.
      float a = step(campusShadowDepth(map, clamp(base,lo,hi),size,receiver,gradient),0.0);
      float b = step(campusShadowDepth(map, clamp(base+vec2(texel.x,0.0),lo,hi),size,receiver,gradient),0.0);
      float c = step(campusShadowDepth(map, clamp(base+vec2(0.0,texel.y),lo,hi),size,receiver,gradient),0.0);
      float d = step(campusShadowDepth(map, clamp(base+texel,lo,hi),size,receiver,gradient),0.0);
      return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
    }
    vec2 campusReceiverGradient(vec3 receiver) {
      vec3 dx = dFdx(receiver), dy = dFdy(receiver);
      float determinant = dx.x * dy.y - dx.y * dy.x;
      vec2 gradient = vec2(0.0);
      if(abs(determinant) > 1e-12) gradient = clamp(vec2(dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z) / determinant, vec2(-4.0), vec2(4.0));
      return gradient;
    }
    float getShadow(sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord) {
      vec3 receiver = shadowCoord.xyz / shadowCoord.w;
      vec2 gradient = campusReceiverGradient(receiver);
      receiver.z += shadowBias;
      if(any(lessThan(receiver.xy, vec2(0.0))) || any(greaterThan(receiver.xy, vec2(1.0))) || receiver.z > 1.0) return 1.0;
      vec2 texel = 1.0 / shadowMapSize;
      // A light-space pattern remains attached to the surface when the camera moves.
      vec2 cell = floor(receiver.xy * shadowMapSize);
      float angle = 6.2831853 * fract(sin(dot(cell, vec2(12.9898,78.233))) * 43758.5453);
      float radiusMetres = uCampusShadowFixedRadius;
      if(uCampusShadowSearch > 0) {
        float searchRadius = min(receiver.z * uCampusShadowDepthRange, 64.0) * uCampusSunRadius / uCampusShadowSpan;
        float separation = 0.0, blockers = 0.0;
        for(int i = 0; i < 12; i++) {
          if(i >= uCampusShadowSearch) break;
          vec2 offset = i == 0 ? vec2(0.0) : campusShadowDisk(i - 1, float(uCampusShadowSearch - 1), angle) * searchRadius;
          vec2 uv = clamp(receiver.xy + offset, texel * 0.5, 1.0 - texel * 0.5);
          float gap = campusShadowDepth(shadowMap, uv, shadowMapSize, receiver, gradient);
          if(gap > 0.0) { separation += gap * uCampusShadowDepthRange; blockers += 1.0; }
        }
        // Sparse searches can miss a thin leaf. Keep the small contact filter on lit edges too.
        if(blockers > 0.5) radiusMetres = separation / blockers * uCampusSunRadius;
      }
      float radius = max(radiusMetres / uCampusShadowSpan, texel.x * 0.55);
      float visibility = 0.0;
      for(int i = 0; i < 20; i++) {
        if(i >= uCampusShadowSamples) break;
        vec2 offset = campusShadowDisk(i, float(uCampusShadowSamples), angle + 0.73) * radius;
        vec2 uv = clamp(receiver.xy + offset, texel * 0.5, 1.0 - texel * 0.5);
        visibility += campusShadowTapVisibility(shadowMap, uv, shadowMapSize, receiver, gradient);
      }
      return mix(1.0, visibility / float(uCampusShadowSamples), shadowIntensity);
    }
    // Leaf transmission already shifts the receiver by 0.25m: it needs local visibility,
    // not a second full blocker search and distance-dependent penumbra calculation.
    float campusLeafTransmissionShadow(sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord) {
      vec3 receiver = shadowCoord.xyz / shadowCoord.w;
      vec2 gradient = campusReceiverGradient(receiver);
      receiver.z += shadowBias;
      if(any(lessThan(receiver.xy, vec2(0.0))) || any(greaterThan(receiver.xy, vec2(1.0))) || receiver.z > 1.0) return 1.0;
      vec2 texel = 1.0 / shadowMapSize;
      vec2 radius = max(vec2(uCampusShadowFixedRadius / uCampusShadowSpan), texel * 0.55);
      float visibility = 0.0;
      for(int i = 0; i < 4; i++) {
        vec2 offset = (vec2(float(i - (i / 2) * 2), float(i / 2)) * 2.0 - 1.0) * radius * 0.707107;
        vec2 uv = clamp(receiver.xy + offset, texel * 0.5, 1.0 - texel * 0.5);
        visibility += step(campusShadowDepth(shadowMap, uv, shadowMapSize, receiver, gradient), 0.0);
      }
      return mix(1.0, visibility * 0.25, shadowIntensity);
    }
  #endif

`;function Me(){let e=n.shadowmap_pars_fragment,t=e.lastIndexOf(`float getShadow(`),r=e.lastIndexOf(`#else`,t),i=e.indexOf(`#if NUM_SUN_LIGHT_SHADOWS`,r);if(r<0||i<0||!e.slice(t,t+90).includes(`sampler2D shadowMap`))throw Error(`Campus soft shadows: unsupported Three shadow chunk`);return e.slice(0,r)+je+e.slice(i)}function Ne(e,t,n){t.shadowMap.type=0;let r={uCampusSunRadius:{value:Ae},uCampusShadowSpan:{value:340},uCampusShadowDepthRange:{value:600},uCampusShadowFixedRadius:{value:.035},uCampusShadowSearch:{value:4},uCampusShadowSamples:{value:8}},i=Me(),a=new Map;e.traverse(e=>{let t=e.material;if(!t?.isMeshStandardMaterial||a.has(t))return;let n=t.onBeforeCompile,o=t.customProgramCacheKey,s=o.call(t);a.set(t,{compile:n,cacheKey:o}),t.onBeforeCompile=function(e,t){n.call(this,e,t),Object.assign(e.uniforms,r),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
          #define CAMPUS_SOFT_SHADOWS
          uniform float uCampusSunRadius, uCampusShadowSpan, uCampusShadowDepthRange, uCampusShadowFixedRadius;
          uniform int uCampusShadowSearch, uCampusShadowSamples;`).replace(`#include <shadowmap_pars_fragment>`,i)},t.customProgramCacheKey=()=>`${s}-campus-soft-sun-v3-tap-bilinear`,t.needsUpdate=!0});let o={uniforms:r,setQuality(e){r.uCampusShadowSearch.value=Math.min(12,Math.max(0,e.shadowSearch??4)),r.uCampusShadowSamples.value=Math.min(20,Math.max(1,e.shadowSamples??8))},update(){let e=n.shadow.camera;r.uCampusShadowSpan.value=e.right-e.left,r.uCampusShadowDepthRange.value=e.far-e.near},dispose(){for(let[e,t]of a)e.onBeforeCompile=t.compile,e.customProgramCacheKey=t.cacheKey,e.needsUpdate=!0;a.clear(),delete n.userData.campusShadows}};return n.userData.campusShadows=o,o.update(),o}var Pe=7,Fe=[.9013991766,.8007643477,.6656584172],J=Object.freeze({direction:[.35,.72,.6684309986827361],color:new S(1,Fe[1]/Fe[0],Fe[2]/Fe[0]),intensity:Pe*Fe[0],skyIntensity:Pe,environmentIntensity:1,hemisphereIntensity:0,angularRadius:Ae});function Ie(e,a){let o=new z(...J.direction).normalize(),c=ae();c.material.uniforms=R.clone(c.material.uniforms);let u=c.material.uniforms;u.uCampusSolarRadius={value:J.angularRadius},c.material.fragmentShader=c.material.fragmentShader.replace(`uniform float uSunI;`,`uniform float uSunI;
uniform float uCampusSolarRadius;`).replace(`float R = 0.0095;`,`float R = uCampusSolarRadius;`).replace(`sunI * 700.0 * disc`,`sunI * 700.0 * pow(0.0095 / uCampusSolarRadius, 2.0) * disc`),u.uSunDir.value.copy(o),u.uSunI.value=J.skyIntensity,u.uCloudCover.value=.39,u.uCloudOpacity.value=.85,e.fog=new s(`#c8d6d7`,62e-5);let d=new x(J.color,J.intensity);d.userData.direction=o;let f=new l(new z(-130,-1,-115),new z(130,40,115));for(let t of e.getObjectByName(`campus-landscape`)?.userData.contextTreePositions||[]){let e=t.height*.42+3,n=t.ground||0;f.expandByPoint(new z(t.x-e,n,t.z-e)),f.expandByPoint(new z(t.x+e,n+t.height*1.1+3,t.z+e))}d.userData.campusOverviewBounds=f,d.position.copy(o).multiplyScalar(220),d.target.position.set(0,0,0),d.castShadow=!0,Object.assign(d.shadow.camera,{left:-170,right:170,top:170,bottom:-170,near:20,far:480}),d.shadow.camera.updateProjectionMatrix(),d.shadow.bias=-4e-5,d.shadow.normalBias=.018,d.shadow.radius=1.8,e.add(d,d.target);let p=new T(`#c5dced`,`#aaa18a`,J.hemisphereIntensity);e.add(p);let m=new ee;m.add(c);let h=new t(1024,{type:E}),g=new t(256,{type:E}),_=new r(a),v=a.getRenderTarget(),y;try{new i(.1,5e3,h).update(a,m),u.uSunDisc.value=0,new i(.1,5e3,g).update(a,m),y=_.fromCubemap(g.texture)}catch(e){throw h.dispose(),g.dispose(),e}finally{a.setRenderTarget(v),_.dispose(),c.geometry.dispose(),c.material.dispose()}e.background=h.texture,e.backgroundIntensity=1,e.environment=y.texture,e.environmentIntensity=J.environmentIntensity;let b=new Set;e.traverse(e=>{e.material?.isMeshStandardMaterial&&b.add(e.material)});let S=n.fog_fragment.replace(`fogColor, fogFactor`,`textureCube(uCampusFogSky, inverseTransformDirection(-vViewPosition, viewMatrix)).rgb, fogFactor`);for(let e of b){let t=e.onBeforeCompile,n=e.customProgramCacheKey();e.onBeforeCompile=function(e,n){t.call(this,e,n),e.uniforms.uCampusFogSky={value:h.texture},e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
uniform samplerCube uCampusFogSky;`).replace(`#include <fog_fragment>`,S)},e.customProgramCacheKey=()=>`${n}-campus-sky-haze`,e.needsUpdate=!0}return{sun:d,hemisphere:p,shadows:Ne(e,a,d),skyTarget:y,backgroundTarget:h,probeBackground:g}}function Le(e,t=-1){e.shadow.camera.up.set(0,t===4?0:1,+(t===4));let[n,r,i,a]=[[0,12,5,140],[0,10,35,105],[0,12,26,60],[0,12,-23,68],[-18,12,-43,52],[0,12,5,140]][t]||[0,12,0,170],o=400,s=100,c=700;if((t<0||t===0||t===5)&&e.userData.campusOverviewBounds){let t=e.userData.campusOverviewBounds;[n,r,i]=t.getCenter(new z).toArray();let l=new N().lookAt(e.userData.direction,new z,e.up).invert(),u=t.clone().applyMatrix4(l).getSize(new z);a=Math.max(u.x,u.y)*.5+4,o=u.z*.5+100,s=50,c=u.z+200}e.target.position.set(n,r,i),e.target.updateMatrixWorld(),e.position.copy(e.target.position).addScaledVector(e.userData.direction,o),e.updateMatrixWorld(),Object.assign(e.shadow.camera,{left:-a,right:a,top:a,bottom:-a,near:s,far:c});let l=a*2/e.shadow.mapSize.x;e.shadow.bias=-.002/(e.shadow.camera.far-e.shadow.camera.near),e.shadow.normalBias=Math.min(.008,l*.2),e.shadow.camera.updateProjectionMatrix(),e.shadow.needsUpdate=!0,e.userData.campusShadows?.update()}function Re(e,n,a){let o=new t(128,{type:E}),s=new i(1,1800,o);s.position.set(0,16,9);let c=n.getRenderTarget(),l=new r(n);try{s.update(n,e);let t=l.fromCubemap(o.texture);return e.environment=t.texture,a.dispose(),t}finally{n.setRenderTarget(c),o.dispose(),l.dispose()}}var ze={uniforms:{tDiffuse:{value:null},tDepth:{value:null},uResolution:{value:new I},uProj:{value:new N},uInvProj:{value:new N},uRadius:{value:.45}},vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`
    varying vec2 vUv;
    uniform sampler2D tDiffuse, tDepth;
    uniform vec2 uResolution;
    uniform mat4 uProj, uInvProj;
    uniform float uRadius;
    vec3 vp(vec2 uv){float d=texture2D(tDepth,uv).r;vec4 p=uInvProj*vec4(uv*2.-1.,d*2.-1.,1.);return p.xyz/p.w;}
    void main(){
      vec4 color=texture2D(tDiffuse,vUv);
      float d=texture2D(tDepth,vUv).r;
      if(d>=.99999){gl_FragColor=color;return;}
      vec2 px=1./uResolution;
      vec3 p=vp(vUv), pl=vp(vUv-vec2(px.x,0.)),pr=vp(vUv+vec2(px.x,0.));
      if(-p.z>65.){gl_FragColor=color;return;}
      vec3 pb=vp(vUv-vec2(0.,px.y)),pt=vp(vUv+vec2(0.,px.y));
      vec3 dx=abs(pr.z-p.z)<abs(p.z-pl.z)?pr-p:p-pl;
      vec3 dy=abs(pt.z-p.z)<abs(p.z-pb.z)?pt-p:p-pb;
      vec3 n=normalize(cross(dx,dy));
      float radius=min(64.,uRadius*uProj[1][1]*.5*uResolution.y/max(.1,-p.z));
      float angle=6.2831853*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))*52.9829189);
      float occ=0.;
      for(int i=0;i<12;i++){
        float fi=(float(i)+.5)/12.,a=angle+float(i)*2.399963;
        vec2 sampleUV=vUv+vec2(cos(a),sin(a))*sqrt(fi)*radius*px;
        if(any(lessThan(sampleUV,vec2(0.)))||any(greaterThan(sampleUV,vec2(1.))))continue;
        vec3 v=vp(sampleUV)-p;
        float dist2=dot(v,v),falloff=max(0.,1.-dist2/(uRadius*uRadius));
        occ+=falloff*falloff*max(0.,dot(v,n)-max(.008,-p.z*.0003))/(dist2+.025);
      }
      // Distant depth precision cannot resolve centimetre-scale contact shadows.
      float fade=(1.-smoothstep(30.,65.,-p.z))*smoothstep(1.5,4.,radius);
      // shortcut: this post pass has no material separation; cap it at weak local contact only.
      float visibility=clamp(1.-occ*.065*fade,.88,1.);
      gl_FragColor=vec4(color.rgb*visibility,color.a);
    }`};function Be(e,t,n){let r=new j(1,1,{type:E,depthBuffer:!0,samples:2});r.depthTexture=new k(1,1,g);let i=new Ce(e,r);i.addPass(new we(t,n));let a=new be(ze);i.addPass(a);let o=new Ee(new I(1,1),.035,.18,8);i.addPass(o),i.addPass(new Oe);let s=new be(ke);return i.addPass(s),{composer:i,ao:a,bloom:o,resize(e,t,n){a.enabled=n.ao,o.enabled=n.bloom;for(let e of[i.renderTarget1,i.renderTarget2])e.samples!==n.samples&&(e.samples=n.samples,e.dispose());i.setSize(e,t),a.uniforms.uResolution.value.set(e,t),s.uniforms.resolution.value.set(1/e,1/t)},render(){a.uniforms.tDepth.value=i.readBuffer.depthTexture,a.uniforms.uProj.value.copy(n.projectionMatrix),a.uniforms.uInvProj.value.copy(n.projectionMatrixInverse),i.render()},dispose(){for(let e of i.passes)e.dispose?.();i.dispose()}}}function*Ve(e,n,a){let o=new Set;a.traverse(e=>{e.material?.userData.campusGlass&&o.add(e.material)});let s=new t(512,{type:E}),c=new i(.5,1800,s),l=new r(n),u=n.getRenderTarget(),d=[],f=[],p=e.getObjectByName(`Daylight sky`)?.material.uniforms.showSunDisc,m=p?.value,h=!1;try{p&&(p.value=0);for(let t of o){c.position.fromArray(t.userData.campusGlass.probe.position),c.update(n,e);let r=l.fromCubemap(s.texture);d.push(r),f.push([t,r]),n.setRenderTarget(u),yield`正在生成玻璃反射（${d.length}/${o.size}）…`}for(let[e,t]of f)e.envMap=t.texture,e.userData.campusGlass.uniforms.uCampusProbeEnabled.value=1,e.needsUpdate=!0;h=!0}finally{if(!h)for(let e of d)e.dispose();p&&(p.value=m),n.setRenderTarget(u),s.dispose(),l.dispose()}return{count:d.length,dispose(){for(let[e,t]of f)e.envMap===t.texture&&(e.envMap=null,e.userData.campusGlass.uniforms.uCampusProbeEnabled.value=0,e.needsUpdate=!0),t.dispose()}}}var He=12,Ue=.002,We=new N().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);function Ge(e,t,n,r){let i=n.getObjectByName(`Solar control glass / west`)?.material.userData.campusGlass?.planarUniforms;if(!i||!r?.isTexture)throw Error(`Planar reflections require glazing hooks and the sun-free sky texture`);e.updateMatrixWorld(!0);let s=n.matrixWorld,c=new ne().getNormalMatrix(s);for(let e of[1,2,4,6,8,9])if(Math.abs(s.elements[e])>1e-6)throw Error(`Planar reflection domains require axis-aligned architecture`);let u=(n.userData.arcadePlanarSurfaces||[]).map(e=>{let t=new z(...e.point).applyMatrix4(s),n=new z(...e.normal).applyMatrix3(c).normalize(),r=new l(new z(...e.min),new z(...e.max)).applyMatrix4(s);return{id:e.id,point:t,normal:n,bounds:r,plane:new o().setFromNormalAndCoplanarPoint(n,t)}});if(u.length!==2)throw Error(`Planar reflections require the two generated arcade glass planes`);let d=new Set;e.traverse(e=>{for(let t of Array.isArray(e.material)?e.material:[e.material])t?.userData.campusGlass&&d.add(t.userData.campusGlass)});let f={enabled:!0,activeSurface:null,updates:0,reuses:0,width:0,height:0,lastUpdateMs:0,error:null},h=new z,g=new z,_=new z,v=new z,b=new m,x=new N,S=new N,w=new N,T=new N,D=new I,O=null,k=null,A=null,ee=-1,P=!0,te=!1,F=!1;function L(){i.uCampusPlanarEnabled.value=0,f.activeSurface=null,te=!1}return{stats:f,update(n,{scale:s=1}={}){if(F||!P||!(s>0)||!Number.isFinite(s))return L(),!1;n.updateWorldMatrix(!0,!1),h.setFromMatrixPosition(n.matrixWorld),x.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),b.setFromProjectionMatrix(x,n.coordinateSystem);let c=null,l=He;for(let e of u){if(e.plane.distanceToPoint(h)<=.05||!b.intersectsBox(e.bounds))continue;e.bounds.clampPoint(h,g);let t=g.distanceTo(h);t<l&&(c=e,l=t)}if(!c)return L(),!1;let m=1-H.smoothstep(l,8,He);t.getDrawingBufferSize(D);let N=Math.min(s,1,2048/Math.max(D.x,D.y)),I=Math.max(1,Math.round(D.x*N)),R=Math.max(1,Math.round(D.y*N));if(te&&c.id===A&&I===f.width&&R===f.height&&n.layers.mask===ee&&n.matrixWorld.equals(w)&&n.projectionMatrix.equals(T)&&!t.shadowMap.needsUpdate)return i.uCampusPlanarEnabled.value=m,f.activeSurface=c.id,f.reuses++,!1;if(O)(O.width!==I||O.height!==R)&&O.setSize(I,R);else{let e=t.getContext(),n=e.getInternalformatParameter(e.RENDERBUFFER,e.RGBA16F,e.SAMPLES),r=Math.max(0,...Array.from(n||[]).filter(e=>e<=4));O=new j(I,R,{type:E,format:a,colorSpace:C,minFilter:p,magFilter:y,generateMipmaps:!0,depthBuffer:!0,stencilBuffer:!1,samples:r})}O.texture.name=`Nearest arcade planar radiance`,(!k||k.type!==n.type)&&(k=n.clone(!1));let z=e=>e.addScaledVector(c.normal,-2*c.plane.distanceToPoint(e));k.position.copy(z(h.clone())),n.getWorldDirection(_),_.add(h),z(_),v.setFromMatrixColumn(n.matrixWorld,1).normalize().reflect(c.normal),k.up.copy(v),k.lookAt(_),k.near=n.near,k.far=n.far,k.layers.mask=n.layers.mask,k.updateMatrixWorld(!0),k.projectionMatrix.copy(n.projectionMatrix),k.projectionMatrixInverse.copy(k.projectionMatrix).invert(),S.copy(We).multiply(k.projectionMatrix).multiply(k.matrixWorldInverse);let ne=new o().setFromNormalAndCoplanarPoint(c.normal,c.point.clone().addScaledVector(c.normal,Ue)).applyMatrix4(k.matrixWorldInverse),B=new M(ne.normal.x,ne.normal.y,ne.normal.z,ne.constant),re=new M(Math.sign(B.x),Math.sign(B.y),1,1).applyMatrix4(k.projectionMatrixInverse),V=B.dot(re);if(Math.abs(V)<1e-7)return L(),!1;B.multiplyScalar(2/V);let U=k.projectionMatrix.elements;U[2]=B.x-U[3],U[6]=B.y-U[7],U[10]=B.z-U[11],U[14]=B.w-U[15],k.projectionMatrixInverse.copy(k.projectionMatrix).invert();let W={target:t.getRenderTarget(),face:t.getActiveCubeFace(),mip:t.getActiveMipmapLevel(),viewport:t.getViewport(new M),scissor:t.getScissor(new M),scissorTest:t.getScissorTest(),toneMapping:t.toneMapping,outputColorSpace:t.outputColorSpace,autoClear:t.autoClear,xr:t.xr.enabled,shadowAuto:t.shadowMap.autoUpdate,shadowNeeds:t.shadowMap.needsUpdate,background:e.background},ie=[],ae=performance.now(),G=!1;try{for(let e of d){let t=e.planarUniforms;ie.push({planar:t,enabled:t?.uCampusPlanarEnabled.value,map:t?.uCampusPlanarMap.value}),t&&(t.uCampusPlanarEnabled.value=0,t.uCampusPlanarMap.value=null)}e.background=r,t.xr.enabled=!1,t.shadowMap.autoUpdate=!1,t.toneMapping=0,t.outputColorSpace=C,t.autoClear=!1,t.setRenderTarget(O),t.state.buffers.depth.setMask(!0),t.clear(!0,!0,!0),t.render(e,k),G=!0}catch(e){f.error=e instanceof Error?e.message:String(e)}finally{for(let e of ie)e.planar&&(e.planar.uCampusPlanarEnabled.value=e.enabled,e.planar.uCampusPlanarMap.value=e.map);e.background=W.background,t.xr.enabled=W.xr,t.shadowMap.autoUpdate=W.shadowAuto,G||(t.shadowMap.needsUpdate=W.shadowNeeds||t.shadowMap.needsUpdate),t.toneMapping=W.toneMapping,t.outputColorSpace=W.outputColorSpace,t.autoClear=W.autoClear,t.setViewport(W.viewport),t.setScissor(W.scissor),t.setScissorTest(W.scissorTest),t.setRenderTarget(W.target,W.face,W.mip)}return G?(i.uCampusPlanarMap.value=O.texture,i.uCampusPlanarMatrix.value.copy(S),i.uCampusPlanarGlassMin.value.copy(c.bounds.min).addScaledVector(c.normal,-.003),i.uCampusPlanarGlassMax.value.copy(c.bounds.max).addScaledVector(c.normal,.003),i.uCampusPlanarEnabled.value=m,w.copy(n.matrixWorld),T.copy(n.projectionMatrix),ee=n.layers.mask,A=c.id,te=!0,f.activeSurface=c.id,f.width=I,f.height=R,f.lastUpdateMs=performance.now()-ae,f.updates++,f.error=null,!0):(L(),!1)},setEnabled(e){F||(P=!!e,f.enabled=P,P||L())},dispose(){F||(F=!0,f.enabled=!1,L(),i.uCampusPlanarMap.value===O?.texture&&(i.uCampusPlanarMap.value=null),O?.dispose(),O=null)}}}var Y=null,Ke=null,qe=null,Je=null,Ye=0,Xe=null,Ze=null,Qe=null,$e=0,et=0,tt=0,X=null,nt=0,rt=new z,it=new z,at=new l,Z=null,ot=1,st=class extends W{constructor(e=1,t=1,n=1,r,i,a){super(),this.isLightProbeGrid=!0,this.width=e,this.height=t,this.depth=n,this.resolution=new z(r===void 0?Math.max(2,Math.round(e)+1):r,i===void 0?Math.max(2,Math.round(t)+1):i,a===void 0?Math.max(2,Math.round(n)+1):a),this.boundingBox=new l,this.texture=null,this._renderTarget=null,this._bounceTarget=null,this._bouncePass=-1,this.updateBoundingBox()}getProbePosition(e,t,n,r){let i=this.position,a=this.resolution,o=this.width,s=this.height,c=this.depth;return r.set(a.x>1?i.x-o/2+e*o/(a.x-1):i.x,a.y>1?i.y-s/2+t*s/(a.y-1):i.y,a.z>1?i.z-c/2+n*c/(a.z-1):i.z),r}updateBoundingBox(){it.set(this.width,this.height,this.depth),this.boundingBox.setFromCenterAndSize(this.position,it)}bake(e,t,n={}){let r=this.resolution,i=r.x*r.y*r.z,{bounces:a=0,start:o=0,count:s=i-o,pass:c=0}=n,l=o+s;if(!Number.isInteger(o)||!Number.isInteger(s)||o<0||s<0||l>i)throw RangeError(`THREE.LightProbeGridWebGL: Invalid probe range.`);if(!Number.isInteger(c)||c<0||!Number.isInteger(a)||a<0)throw RangeError(`THREE.LightProbeGridWebGL: Pass and bounce counts must be non-negative integers.`);if(a>0&&s!==i)throw RangeError(`THREE.LightProbeGridWebGL: For ranged baking, use pass instead of bounces.`);if(s===0)return;if(c>0&&o>0&&this._bouncePass!==c)throw Error(`THREE.LightProbeGridWebGL: Start each indirect pass at probe 0.`);this._ensureTextures(),this.updateBoundingBox(),dt(n),ft(i),ut();let u=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),p=e.autoClear,m=e.xr.enabled,h=e.shadowMap.autoUpdate,g=t.matrixWorldAutoUpdate,_=this.visible,v=this.texture,y=this._renderTarget,b=y.viewport.clone(),x=null;try{this.visible=!0,g===!0&&(t.updateMatrixWorld(!0),t.matrixWorldAutoUpdate=!1),x=_e(t),e.shadowMap.autoUpdate=!1,e.shadowMap.needsUpdate=!0;for(let n=c;n<=c+a;n++)this._updateBakeTexture(e,n,o),this._captureProbes(e,t,o,l),this._repackProbes(e,o,l)}finally{y.viewport.copy(b),e.setRenderTarget(u,d,f),e.autoClear=p,e.xr.enabled=m,e.shadowMap.autoUpdate=h,x!==null&&pe(t,x),t.matrixWorldAutoUpdate=g,this.visible=_,this.texture=v}}_updateBakeTexture(e,t,n){if(t===0)this.texture=Z,n===0&&(this._bouncePass=-1);else{if(n===0){let n=this._renderTarget;this._bounceTarget===null&&(this._bounceTarget=n.clone()),e.initRenderTarget(n),e.initRenderTarget(this._bounceTarget),at.min.set(0,0,0),at.max.set(n.width,n.height,n.depth),e.copyTextureToTexture(n.texture,this._bounceTarget.texture,at),this._bouncePass=t}this.texture=this._bounceTarget.texture}}_captureProbes(e,t,n,r){let{x:i,y:a,z:o}=this.resolution,s=i*o;qe.material=Je,Je.uniforms.envMap.value=Ze.texture;for(let c=n;c<r;c++){let n=c%i,r=Math.floor(c/s),l=Math.floor(c/i)%o;this.getProbePosition(n,r,l,rt),Qe.position.copy(rt),e.autoClear=!0,Qe.update(e,t);let u=n+r*i+l*i*a;e.autoClear=!1,X.viewport.set(0,u,9,1),e.setRenderTarget(X),e.render(Y,Ke)}}_repackProbes(e,t,n){let{x:r,y:i,z:a}=this.resolution,o=r*a,s=Math.floor(t/o),c=Math.floor(n/o),l=a+2,u=this._renderTarget;for(let e of Xe)e.uniforms.batchTexture.value=X.texture,e.uniforms.resolution.value.copy(this.resolution);for(let d=0;d<a;d++){let f=s*r+H.clamp(t%o-d*r,0,r),p=c*r+H.clamp(n%o-d*r,0,r);for(let t=f;t<p;){let n=t%r,o=Math.floor(t/r),s=Math.min(r-n,p-t),c=1;s===r&&(c=Math.min(i-o,Math.floor((p-t)/r))),u.viewport.set(n,o,s,c);for(let t=0;t<7;t++){qe.material=Xe[t],qe.material.uniforms.sliceZ.value=d;let n=t*l;e.setRenderTarget(u,n+ot+d),e.render(Y,Ke),d===0&&(e.setRenderTarget(u,n),e.render(Y,Ke)),d===a-1&&(e.setRenderTarget(u,n+ot+a),e.render(Y,Ke))}t+=s*c}}}_ensureTextures(){if(this._renderTarget!==null)return;let e=this.resolution,t=e.x,n=e.y,r=7*(e.z+2),i=new A(t,n,r,{format:a,type:b,minFilter:y,magFilter:y,generateMipmaps:!1,depthBuffer:!1});this._renderTarget=i,this.texture=i.texture}dispose(){this._bounceTarget!==null&&(this._bounceTarget.dispose(),this._bounceTarget=null,this._bouncePass=-1),this._renderTarget!==null&&(this._renderTarget.dispose(),this._renderTarget=null,this.texture=null)}};function ct(){Y===null&&(Ke=new c(-1,1,1,-1,0,1),qe=new O(new P(2,2)),Y=new ee,Y.add(qe))}function lt(e){ct(),e!==Ye&&(Je!==null&&Je.dispose(),Je=new V({precision:`highp`,defines:{CUBEMAP_SIZE:e},uniforms:{envMap:{value:null}},vertexShader:`
				void main() {
					gl_Position = vec4( position.xy, 0.0, 1.0 );
				}
			`,fragmentShader:`
				#include <common>

				uniform samplerCube envMap;

				void main() {

					int coefIndex = int( gl_FragCoord.x );

					vec3 accum0 = vec3( 0.0 );
					vec3 accum1 = vec3( 0.0 );
					vec3 accum2 = vec3( 0.0 );
					vec3 accum3 = vec3( 0.0 );
					vec3 accum4 = vec3( 0.0 );
					vec3 accum5 = vec3( 0.0 );
					vec3 accum6 = vec3( 0.0 );
					vec3 accum7 = vec3( 0.0 );
					vec3 accum8 = vec3( 0.0 );
					float totalWeight = 0.0;
					float pixelSize = 2.0 / float( CUBEMAP_SIZE );

					for ( int face = 0; face < 6; face ++ ) {

						for ( int iy = 0; iy < CUBEMAP_SIZE; iy ++ ) {

							for ( int ix = 0; ix < CUBEMAP_SIZE; ix ++ ) {

								// WebGL cubemaps have a left-handed orientation (flip = -1)
								float col = ( float( ix ) + 0.5 ) * pixelSize - 1.0;
								float row = 1.0 - ( float( iy ) + 0.5 ) * pixelSize;

								vec3 coord;

								if ( face == 0 ) coord = vec3( 1.0, row, -col );
								else if ( face == 1 ) coord = vec3( -1.0, row, col );
								else if ( face == 2 ) coord = vec3( col, 1.0, -row );
								else if ( face == 3 ) coord = vec3( col, -1.0, row );
								else if ( face == 4 ) coord = vec3( col, row, 1.0 );
								else coord = vec3( -col, row, -1.0 );

								float lengthSq = dot( coord, coord );
								float weight = 4.0 / ( sqrt( lengthSq ) * lengthSq );
								totalWeight += weight;

								vec3 dir = normalize( coord );
								vec3 cw = textureCube( envMap, coord ).rgb * weight;

								// band 0
								accum0 += cw * 0.282095;

								// band 1
								accum1 += cw * ( 0.488603 * dir.y );
								accum2 += cw * ( 0.488603 * dir.z );
								accum3 += cw * ( 0.488603 * dir.x );

								// band 2
								accum4 += cw * ( 1.092548 * ( dir.x * dir.y ) );
								accum5 += cw * ( 1.092548 * ( dir.y * dir.z ) );
								accum6 += cw * ( 0.315392 * ( 3.0 * dir.z * dir.z - 1.0 ) );
								accum7 += cw * ( 1.092548 * ( dir.x * dir.z ) );
								accum8 += cw * ( 0.546274 * ( dir.x * dir.x - dir.y * dir.y ) );

							}

						}

					}

					float norm = 4.0 * PI / totalWeight;

					vec3 accum;
					if ( coefIndex == 0 ) accum = accum0;
					else if ( coefIndex == 1 ) accum = accum1;
					else if ( coefIndex == 2 ) accum = accum2;
					else if ( coefIndex == 3 ) accum = accum3;
					else if ( coefIndex == 4 ) accum = accum4;
					else if ( coefIndex == 5 ) accum = accum5;
					else if ( coefIndex == 6 ) accum = accum6;
					else if ( coefIndex == 7 ) accum = accum7;
					else accum = accum8;

					gl_FragColor = vec4( accum * norm, 1.0 );

				}
			`}),Ye=e)}function ut(){if(Xe===null){ct(),Xe=[];for(let e=0;e<7;e++)Xe[e]=new V({precision:`highp`,defines:{TEXTURE_INDEX:e},uniforms:{batchTexture:{value:null},resolution:{value:new z},sliceZ:{value:0}},vertexShader:`
		void main() {
			gl_Position = vec4( position.xy, 0.0, 1.0 );
		}
	`,fragmentShader:`
				uniform sampler2D batchTexture;
				uniform vec3 resolution;
				uniform int sliceZ;

				void main() {

					int ix = int( gl_FragCoord.x );
					int iy = int( gl_FragCoord.y );
					int iz = sliceZ;

					int probeIndex = ix + iy * int( resolution.x ) + iz * int( resolution.x ) * int( resolution.y );

					// Read 9 SH coefficients from the batch texture row
					vec4 c0 = texelFetch( batchTexture, ivec2( 0, probeIndex ), 0 );
					vec4 c1 = texelFetch( batchTexture, ivec2( 1, probeIndex ), 0 );
					vec4 c2 = texelFetch( batchTexture, ivec2( 2, probeIndex ), 0 );
					vec4 c3 = texelFetch( batchTexture, ivec2( 3, probeIndex ), 0 );
					vec4 c4 = texelFetch( batchTexture, ivec2( 4, probeIndex ), 0 );
					vec4 c5 = texelFetch( batchTexture, ivec2( 5, probeIndex ), 0 );
					vec4 c6 = texelFetch( batchTexture, ivec2( 6, probeIndex ), 0 );
					vec4 c7 = texelFetch( batchTexture, ivec2( 7, probeIndex ), 0 );
					vec4 c8 = texelFetch( batchTexture, ivec2( 8, probeIndex ), 0 );

					// Pack into the output format for this texture index
					#if TEXTURE_INDEX == 0
						gl_FragColor = vec4( c0.rgb, c1.r );
					#elif TEXTURE_INDEX == 1
						gl_FragColor = vec4( c1.gb, c2.rg );
					#elif TEXTURE_INDEX == 2
						gl_FragColor = vec4( c2.b, c3.rgb );
					#elif TEXTURE_INDEX == 3
						gl_FragColor = vec4( c4.rgb, c5.r );
					#elif TEXTURE_INDEX == 4
						gl_FragColor = vec4( c5.gb, c6.rg );
					#elif TEXTURE_INDEX == 5
						gl_FragColor = vec4( c6.b, c7.rgb );
					#else
						gl_FragColor = vec4( c8.rgb, 0.0 );
					#endif

				}
			`})}}function dt(e){Z===null&&(Z=new U(new Uint16Array(4),1,1,1),Z.type=E,Z.minFilter=y,Z.magFilter=y,Z.needsUpdate=!0);let{cubemapSize:n=8,near:r=.1,far:a=100}=e;(Ze===null||n!==$e||r!==et||a!==tt)&&(Ze!==null&&Ze.dispose(),Ze=new t(n,{type:E}),Qe=new i(r,a,Ze),$e=n,et=r,tt=a),lt(n)}function ft(e){(X===null||nt!==e)&&(X!==null&&X.dispose(),X=new j(9,e,{type:b,minFilter:D,magFilter:D,depthBuffer:!1}),nt=e)}var pt=2.4,mt=.18;function ht(e=he){return e.filter(e=>e.arcade).map(e=>{if(e.entranceSide!==`east`)throw Error(`Arcade irradiance currently covers the two east-facing west arcades`);let t=e.x+e.w/2,n=.16+e.floorHeight-.35,r=t-pt-.1275,i=new z(t-1.72,.4,e.z-e.d/2+.9),a=new z(t+.3,n-.24,e.z+e.d/2-.9),o=a.clone().sub(i),s=new st(o.x,o.y,o.z,3,4,18);return s.position.copy(i).add(a).multiplyScalar(.5),s.updateBoundingBox(),{id:e.id,building:e,grid:s,count:216,front:t,wall:r,ceiling:n,min:new z(r,-.02,e.z-e.d/2),max:new z(t+.75,n+.03,e.z+e.d/2)}})}function gt(e=he){let t=e.find(e=>e.kind===`commons`);if(!t)throw Error(`Cafe irradiance requires the commons building`);let n=t.x+t.w/2,r=n-5-.1275,i=.16+t.floorHeight-.44,a=new z(n-4.7,.4,t.z-t.d/2+.45),o=new z(n+.2,i-.27,t.z+t.d/2-.45),s=o.clone().sub(a),c=new st(s.x,s.y,s.z,4,4,10);return c.position.copy(a).add(o).multiplyScalar(.5),c.updateBoundingBox(),{id:t.id,building:t,grid:c,count:160,front:n,wall:r,ceiling:i,min:new z(r,-.02,t.z-t.d/2-.7),max:new z(n+.8,i+.02,t.z+t.d/2+.7)}}function _t(e=he){let t=new st(40,13.6,104,7,3,15);t.position.set(0,7.2,2),t.updateBoundingBox();let n=new z,r=t.resolution.x*t.resolution.y*t.resolution.z;for(let r=0;r<t.resolution.y;r++)for(let i=0;i<t.resolution.z;i++)for(let a=0;a<t.resolution.x;a++){t.getProbePosition(a,r,i,n);for(let t of e){let e=fe(t,.25);if(n.x>=e.minX&&n.x<=e.maxX&&n.z>=e.minZ&&n.z<=e.maxZ&&n.y<=t.floors*t.floorHeight+1)throw Error(`Courtyard light probe intersects ${t.id}; revise its volume before baking`)}}return{grid:t,count:r}}function vt(e,t,n,r=[],i=[]){let a=new ee;a.background=e.probeBackground.texture,a.backgroundIntensity=1,a.environment=e.skyTarget.texture,a.environmentIntensity=1;let o=[],s=[],c=[],l=e=>(o.push(e),e),u=e=>{let t=new F(e);return s.push(t),t},d=l(new h),f=new N,p=new w,m=[],g=[],_=[],y=[],b=[],C=[],T=(e,t,n,r,i,a,o)=>({position:[e,t,n],size:[r,i,a],color:o});for(let e of he){let t=e.floors*e.floorHeight,n=e.kind===`headquarters`?`#777f7d`:`#b5b0a2`,i=r.find(t=>t.id===e.id);if(e.kind===`commons`){let t=e.x+e.w/2,r=.16+e.floorHeight,i=r-.44;m.push(T(e.x-2.5,.16+e.floorHeight/2,e.z,e.w-5-.46,e.floorHeight,e.d-.46,`#283236`)),m.push(T(e.x-3.5,r+(e.floors-1)*e.floorHeight/2,e.z+3.4,e.w-8,(e.floors-1)*e.floorHeight,e.d-7,n)),y.push(T(e.x,r-.18,e.z,e.w+1.6,.52,e.d+1.4)),b.push(T((t-5.08+t+.08)/2,.08,e.z,5.16,.16,e.d+.16));for(let[e,n,r,i]of[[-16.55,t+.08,54.65,56.92],[-22,-16.55,54.65,54.845]])b.push(T((e+n)/2,.08,(r+i)/2,n-e,.16,i-r));for(let e of[57.8,63.2,68.6,74])g.push(T(t-.35,(i+.16)/2,e,.24,i-.16,.24,`#353f40`)),_.push(T(t-.35,.18,e,.32,.04,.32,`#353f40`));continue}if(!i){m.push(T(e.x,t/2,e.z,e.w,t,e.d,n));continue}let{front:a,wall:o,ceiling:s}=i,c=.16+e.floorHeight,l=e.x-e.w/2;m.push(T((l+o)/2,c/2,e.z,o-l,c,e.d,`#283236`)),m.push(T(e.x,(c+.16+t)/2,e.z,e.w,.16+t-c,e.d,n)),C.push(T(a-pt/2,c-.16,e.z,pt,.32,e.d)),y.push(T(a-pt/2,s+.01,e.z,2.05,.02,e.d-.6)),b.push(T(a-pt/2,mt/2,e.z,pt,mt,e.d));let u=2*Math.ceil(e.d/12),d=(e.d-1.2)/u;for(let t=0;t<=u;t++){let n=-(e.d-1.2)/2+t*d;Math.abs(n)<3||(g.push(T(a-.28,(c-.32+.18)/2,e.z-n,.44,c-.32-.18,.44)),_.push(T(a-.28,.318,e.z-n,.46,.284,.46)))}}let E=(e,t,n,r)=>{let i=new B(d,u({color:16777215,roughness:n}),e.length);e.forEach((e,n)=>{f.makeScale(...e.size).setPosition(...e.position),i.setMatrixAt(n,f),i.setColorAt(n,new S(e.color||t))}),i.name=r,i.castShadow=i.receiveShadow=!0,a.add(i),c.push(i)};E(m,`#b5b0a2`,.85,`GI building volumes`),E(g,`#a9ada7`,.84,`GI arcade columns`),E(_,`#555c5b`,.8,`GI arcade column bases`),E(C,`#a9ada7`,.84,`GI arcade slabs`),E(y,`#805b3d`,.72,`GI arcade ash soffits`),E(b,`#8d8b80`,.82,`GI arcade stone floors`);let D=new O(l(new P(600,600)),u({color:`#3e5427`,roughness:1}));D.rotation.x=-Math.PI/2,D.position.y=-.025,D.receiveShadow=!0,a.add(D);let k=n.flatMap(e=>e.points.slice(1).map((t,n)=>({a:e.points[n],b:t,width:e.width}))).filter(({a:e,b:t})=>Math.hypot(t.x-e.x,t.z-e.z)>.01),A=new B(d,u({color:`#c5c2b4`,roughness:.95}),k.length);k.forEach(({a:e,b:t,width:n},r)=>{let i=t.x-e.x,a=t.z-e.z;p.setFromAxisAngle(new z(0,1,0),Math.atan2(i,a)),f.compose(new z((e.x+t.x)/2,.04,(e.z+t.z)/2),p,new z(n,.02,Math.hypot(i,a)+.02)),A.setMatrixAt(r,f)}),A.receiveShadow=!0,a.add(A),c.push(A);let j=new B(l(new v(1,1)),u({color:`#365329`,roughness:1,alphaHash:!0,opacity:.55,side:2}),t.length+i.length);t.forEach((e,t)=>{e.crownEnvelope?f.makeScale(...e.crownEnvelope.radii).setPosition(...e.crownEnvelope.center):f.makeScale(e.radius||e.height*.36,e.height*.29,e.radius||e.height*.36).setPosition(e.x,(e.ground||0)+e.height*.71,e.z),j.setMatrixAt(t,f)}),i.forEach((e,n)=>{f.makeScale(...e.radii).setPosition(...e.center),j.setMatrixAt(t.length+n,f)}),j.castShadow=j.receiveShadow=!0,j.customDepthMaterial=new re({alphaHash:!0,opacity:.55,side:2}),s.push(j.customDepthMaterial),a.add(j),c.push(j);let M=new x(e.sun.color.clone(),e.sun.intensity);M.position.copy(e.sun.userData.direction).multiplyScalar(180).add(new z(0,10,2)),M.target.position.set(0,10,2),M.castShadow=!0,M.shadow.mapSize.setScalar(1024),Object.assign(M.shadow.camera,{left:-110,right:110,bottom:-110,top:110,near:30,far:350}),M.shadow.camera.updateProjectionMatrix(),M.shadow.normalBias=.025,M.shadow.bias=-8e-5,a.add(M,M.target);let te=0;a.traverse(e=>{e.isMesh&&(te+=(e.geometry.index?.count||e.geometry.attributes.position.count)/3*(e.isInstancedMesh?e.count:1))});let I=!1;return{scene:a,triangles:te,dispose(){if(!I){I=!0;for(let e of c)e.dispose();for(let e of o)e.dispose();for(let e of s)e.dispose();M.shadow.map?.dispose(),M.shadow.mapPass?.dispose()}}}}function yt(e,t,r,{trees:i=[],paths:a=[],shrubs:o=[]}={}){if(!t.extensions.has(`EXT_color_buffer_float`)||!t.extensions.has(`OES_texture_float_linear`))throw Error(`Courtyard irradiance requires renderable, linearly filtered float textures`);let s=_t(),c=ht(),l=gt(),u=[...c,l],d=[s,...u],{grid:f}=s,p=d.reduce((e,t)=>e+t.count,0),m=o.map(({shapeSeed:e,leafBounds:t})=>{let n=t?.min,r=t?.max;if(!n||!r||n.length!==3||r.length!==3||!n.every((e,t)=>Number.isFinite(e)&&Number.isFinite(r[t])&&r[t]>e))throw Error(`Invalid mature shrub leaf bounds: ${e}`);return{shapeSeed:e,center:n.map((e,t)=>(e+r[t])/2),radii:n.map((e,t)=>(r[t]-e)/2)}}),h=new z;for(let e of d){let{grid:t}=e,n=e===s?.1:.05;for(let e=0;e<t.resolution.y;e++)for(let r=0;r<t.resolution.z;r++)for(let i=0;i<t.resolution.x;i++){t.getProbePosition(i,e,r,h);for(let e of m){let t=h.toArray().map((t,n)=>(t-e.center[n])/e.radii[n]);if((Math.hypot(...t)-1)*Math.min(...e.radii)<=Math.sqrt(3)*n+.02)throw Error(`Light probe intersects mature shrub proxy: ${e.shapeSeed}`)}}}let g=vt(r,i,a,c,m),_=new U(new Float32Array(4),1,1,1);_.type=b,_.needsUpdate=!0;let v={uCampusGIAtlas:{value:_},uCampusGIEnabled:{value:0},uCampusArcadeEnabled:{value:0},uCampusGIMin:{value:f.boundingBox.min.clone()},uCampusGIMax:{value:f.boundingBox.max.clone()},uCampusGIResolution:{value:f.resolution.clone()}};u.forEach((e,t)=>{v[`uCampusArcadeAtlas${t}`]={value:_},v[`uCampusArcadeProbeMin${t}`]={value:e.grid.boundingBox.min.clone()},v[`uCampusArcadeProbeMax${t}`]={value:e.grid.boundingBox.max.clone()},v[`uCampusArcadeResolution${t}`]={value:e.grid.resolution.clone()},v[`uCampusArcadeMin${t}`]={value:e.min.clone()},v[`uCampusArcadeMax${t}`]={value:e.max.clone()}});let y=n.lightprobes_pars_fragment.replace(`#ifdef USE_LIGHT_PROBES_GRID`,``).replace(/#endif\s*$/,``).replace(`uniform highp sampler3D probesSH;`,``).replace(/uniform vec3 probes(?:Min|Max|Resolution);/g,``).replace(`vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal )`,`vec3 campusProbeIrradiance(highp sampler3D probesSH, vec3 probesMin, vec3 probesMax, vec3 probesResolution, vec3 worldPos, vec3 worldNormal)`).replace(`worldNormal * probeSpacing * 0.5`,`worldNormal * min(probeSpacing * 0.1, vec3(0.35))`),x=u.map((e,t)=>`
    uniform highp sampler3D uCampusArcadeAtlas${t};
    uniform vec3 uCampusArcadeProbeMin${t}, uCampusArcadeProbeMax${t}, uCampusArcadeResolution${t};
    uniform vec3 uCampusArcadeMin${t}, uCampusArcadeMax${t};`).join(`
`),S=u.map((e,t)=>`
    float arcadeWeight${t}=campusArcadeWeight(p,n,uCampusArcadeMin${t},uCampusArcadeMax${t});`).join(`
`),C=u.length?u.map((e,t)=>`arcadeWeight${t}`).join(`+`):`0.0`,w=u.map((e,t)=>`
    if(arcadeWeight${t}>0.001) {
      vec3 local=campusProbeIrradiance(uCampusArcadeAtlas${t},uCampusArcadeProbeMin${t},uCampusArcadeProbeMax${t},uCampusArcadeResolution${t},p,n);
      if(arcadeWeight${t}>=1.0) return local;
      localSum+=local*arcadeWeight${t};
    }`).join(`
`),T=new Map;e.traverse(e=>{let t=e.material;if(!t?.isMeshStandardMaterial||T.has(t))return;let n=t.onBeforeCompile,r=t.customProgramCacheKey,i=r.call(t);T.set(t,{compile:n,cacheKey:r}),t.onBeforeCompile=function(e,t){n.call(this,e,t),Object.assign(e.uniforms,v),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
varying vec3 vCampusGIPosition;`).replace(`#include <worldpos_vertex>`,`#include <worldpos_vertex>
          vec4 giPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            giPosition = instanceMatrix * giPosition;
          #endif
          vCampusGIPosition = (modelMatrix * giPosition).xyz;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
          varying vec3 vCampusGIPosition;
          uniform float uCampusGIEnabled, uCampusArcadeEnabled;
          uniform highp sampler3D uCampusGIAtlas;
          uniform vec3 uCampusGIMin, uCampusGIMax, uCampusGIResolution;
          ${x}
          ${y}
          float campusCourtyardWeight(vec3 p) {
            vec2 outside = max(uCampusGIMin.xz - p.xz, p.xz - uCampusGIMax.xz);
            float horizontal = 1.0 - smoothstep(0.0, 4.0, max(outside.x, outside.y));
            float vertical = 1.0 - smoothstep(uCampusGIMax.y - 2.0, uCampusGIMax.y + 4.0, p.y);
            return horizontal * vertical;
          }
          float campusArcadeWeight(vec3 p,vec3 n,vec3 low,vec3 high) {
            if(uCampusArcadeEnabled<0.5 || any(lessThan(p,low-vec3(0.0001))) || any(greaterThan(p,high+vec3(0.0001)))) return 0.0;
            // Evaluate just outside the receiving surface so the actual floor,
            // wall and soffit receive GI, without extending it through a solid wall.
            vec3 q=p+n*0.02;
            vec3 lo=smoothstep(vec3(0.0),vec3(0.02,0.02,0.5),q-low);
            vec3 hi=smoothstep(vec3(0.0),vec3(0.45,0.02,0.5),high-q);
            return lo.x*lo.y*lo.z*hi.x*hi.y*hi.z;
          }
          float campusGIWeight(vec3 p,vec3 n) {
            ${S}
            float localWeight=clamp(${C},0.0,1.0);
            return (localWeight+(1.0-localWeight)*campusCourtyardWeight(p))*uCampusGIEnabled;
          }
          vec3 campusLocalIrradiance(vec3 p,vec3 n) {
            ${S}
            vec3 localSum=vec3(0.0);
            ${w}
            float localWeight=clamp(${C},0.0,1.0);
            float centralWeight=(1.0-localWeight)*campusCourtyardWeight(p);
            vec3 central=campusProbeIrradiance(uCampusGIAtlas,uCampusGIMin,uCampusGIMax,uCampusGIResolution,p,n);
            return (localSum+central*centralWeight)/max(localWeight+centralWeight,0.0001);
          }`).replace(`#include <lights_fragment_maps>`,`#include <lights_fragment_maps>
          #if defined(RE_IndirectDiffuse)
            vec3 localNormal = transformNormalByInverseViewMatrix(geometryNormal, viewMatrix);
            float campusGI = campusGIWeight(vCampusGIPosition,localNormal);
            if(campusGI > 0.001) {
              // Replace diffuse sky/hemisphere fill, preserving direct light and specular PMREM.
              irradiance = mix(irradiance, campusLocalIrradiance(vCampusGIPosition, localNormal), campusGI);
              iblIrradiance *= 1.0 - campusGI;
            }
          #endif`).replace(`/* CAMPUS_LEAF_BACK_IRRADIANCE */`,`
          vec3 foliageBackWorldNormal=transformNormalByInverseViewMatrix(-foliageFaceNormal,viewMatrix);
          float foliageBackGI=campusGIWeight(vCampusGIPosition,foliageBackWorldNormal);
          if(foliageBackGI>0.001) {
            foliageBackIrradiance=mix(foliageBackIrradiance,campusLocalIrradiance(vCampusGIPosition,foliageBackWorldNormal),foliageBackGI);
          }`)},t.customProgramCacheKey=()=>`${i}-courtyard-arcade-irradiance-v4-${u.length}`,t.needsUpdate=!0});let E=!1,D=!1,O=!1,k=!0,A={probes:p,courtyardProbes:s.count,arcadeProbes:c.reduce((e,t)=>e+t.count,0),cafeProbes:l.count,cubeViews:p*6,proxyTriangles:g.triangles,shrubProxies:m.length,bakeMs:0},j={stats:A,async bake({onProgress:e=()=>{},yieldControl:n=()=>new Promise(e=>setTimeout(e,0))}={}){if(D)throw Error(`Courtyard irradiance has been disposed`);if(E)return A;if(O)throw Error(`Courtyard irradiance capture is already running`);O=!0;let i=performance.now();try{let r=0;for(let i of d)for(let a=0;a<i.count;a+=14){if(D||t.getContext().isContextLost())throw Error(`Courtyard irradiance capture interrupted`);let o=Math.min(14,i.count-a);i.grid.bake(t,g.scene,{cubemapSize:8,near:i===s?.1:.05,far:500,start:a,count:o}),r+=o,e(r/p),await n()}if(D||t.getContext().isContextLost())throw Error(`Courtyard irradiance capture interrupted`);return v.uCampusGIAtlas.value=f.texture,u.forEach((e,t)=>{v[`uCampusArcadeAtlas${t}`].value=e.grid.texture}),v.uCampusArcadeEnabled.value=+!!k,A.bakeMs=performance.now()-i,E=!0,g.dispose(),A}catch(e){throw j.dispose(),e}finally{O=!1,t.shadowMap.needsUpdate=!0,r.sun.shadow.needsUpdate=!0}},setEnabled(e){v.uCampusGIEnabled.value=e&&E&&!D?1:0},setArcadeEnabled(e){k=!!e,v.uCampusArcadeEnabled.value=k&&E&&!D?1:0},getState:()=>({ready:E,enabled:v.uCampusGIEnabled.value===1,arcadeEnabled:v.uCampusGIEnabled.value===1&&v.uCampusArcadeEnabled.value===1,...A}),dispose(){if(!D){D=!0,v.uCampusGIEnabled.value=v.uCampusArcadeEnabled.value=0;for(let[e,t]of T)e.onBeforeCompile=t.compile,e.customProgramCacheKey=t.cacheKey,e.needsUpdate=!0;T.clear();for(let e of d)e.grid.dispose();_.dispose(),g.dispose()}}};return j}var Q=e=>document.getElementById(e),bt=new URLSearchParams(location.search),xt=Q(`loading`),$=(e,t)=>{Q(`loading-status`).textContent=e,Q(`loading-progress`).style.width=`${t}%`},St=()=>new Promise(e=>{document.hidden?setTimeout(e,0):requestAnimationFrame(()=>setTimeout(e,0))}),Ct;function wt(e){Q(`notice`).textContent=e,Q(`notice`).classList.add(`visible`),clearTimeout(Ct),Ct=setTimeout(()=>Q(`notice`).classList.remove(`visible`),2800)}function Tt(e){console.error(`[campus] initialization failed`,e),window.__ERROR=String(e?.message||e),window.__READY=!1,xt.classList.remove(`done`),$(`未能完成渲染：${e?.message||e}`,100),Q(`retry`).hidden=!1}Q(`retry`).addEventListener(`click`,()=>location.reload()),bt.has(`clean`)&&document.body.classList.add(`clean`);async function Et(){let t=performance.now(),n={},r=Q(`scene`),i=new e({canvas:r,antialias:!1,powerPreference:`high-performance`,alpha:!1});i.setPixelRatio(1),i.outputColorSpace=_,i.toneMapping=6,i.toneMappingExposure=1.8,i.shadowMap.enabled=!0,i.shadowMap.type=1,i.shadowMap.autoUpdate=!1,i.info.autoReset=!1;let a=i.getContext(),o=a.getExtension(`WEBGL_debug_renderer_info`),s=o?a.getParameter(o.UNMASKED_RENDERER_WEBGL):a.getParameter(a.RENDERER);console.info(`[campus] GPU:`,s);let c=[];i.debug.onShaderError=(e,t,n,r)=>{let i=[e.getProgramInfoLog(t),e.getShaderInfoLog(n),e.getShaderInfoLog(r)].filter(Boolean).join(`
`);c.push(i),console.error(`[campus] shader error`,i)};let l=!1;r.addEventListener(`webglcontextlost`,e=>{e.preventDefault(),l=!0,Tt(Error(`显卡渲染上下文已中断，请关闭其他重负载网页后重新加载。`))});let u=async()=>{if(await St(),l)throw Error(`显卡渲染上下文已中断，请重新加载。`)},d=new ee,f=new te(46,1,.25,9e3),p=Number(bt.get(`t`)),m=Number.isFinite(p)&&p>=0?p%ge:0,h=!bt.has(`paused`)&&!matchMedia(`(prefers-reduced-motion: reduce)`).matches,g=!1,v=-1,y=Object.hasOwn(q,bt.get(`quality`))?bt.get(`quality`):`balanced`,b=new ie(f,r);b.enabled=!1,b.enableDamping=!0,b.dampingFactor=.075,b.minDistance=3,b.maxDistance=520,b.maxPolarAngle=Math.PI/2-.035,b.target.set(0,12,-5);let x,S,C,w,T,E,D,O,k,A,j={width:1,height:1};function M(){w?.update(f,{scale:q[y].planarScale}),D.render()}function N(){let e=Math.max(1,r.clientWidth),t=Math.max(1,r.clientHeight);f.aspect=e/t,f.updateProjectionMatrix(),j=ue(e,t,y);let{width:n,height:a}=j;i.setSize(n,a,!1),D?.resize(n,a,q[y]),Q(`performance`).textContent=`${n} × ${a} · 采样帧率…`}function P(e,t=!0){if(!Object.hasOwn(q,e))return;y=e;let n=q[e];x?.shadows?.setQuality(n),T?.setEnabled(n.indirect),x&&x.sun.shadow.mapSize.x!==n.shadow&&(x.sun.shadow.mapSize.setScalar(n.shadow),x.sun.shadow.map?.dispose(),x.sun.shadow.map=null,x.sun.shadow.mapPass?.dispose(),x.sun.shadow.mapPass=null,Le(x.sun,g?-1:v),i.shadowMap.needsUpdate=!0),N();for(let t of document.querySelectorAll(`[data-quality]`))t.setAttribute(`aria-pressed`,String(t.dataset.quality===e));t&&wt(`已切换至${n.label}模式`)}function F(){let e=de(m);if(f.position.copy(e.position),f.lookAt(e.target),f.fov=e.fov,f.updateProjectionMatrix(),b.target.copy(e.target),v!==e.index){v=e.index,x&&(Le(x.sun,v),i.shadowMap.needsUpdate=!0),Q(`chapter-number`).textContent=`${String(e.index+1).padStart(2,`0`)} / 06`,Q(`chapter-title`).textContent=se[e.index].name,Q(`chapter-detail`).textContent=se[e.index].detail;for(let t of document.querySelectorAll(`[data-shot]`))t.setAttribute(`aria-current`,String(+t.dataset.shot===e.index))}}function I(){Q(`play`).textContent=h&&!g?`Ⅱ`:`▶`,Q(`play`).setAttribute(`aria-label`,h&&!g?`暂停漫游`:`播放漫游`),Q(`mode-label`).textContent=g?`自由探索`:h?`自动漫游`:`漫游已暂停`,Q(`free-camera`).setAttribute(`aria-pressed`,String(g)),Q(`free-camera`).innerHTML=g?`返回漫游 <span aria-hidden="true">↙</span>`:`自由探索 <span aria-hidden="true">↗</span>`,Q(`hint`).innerHTML=g?`拖动 旋转 <span>·</span> 滚轮 缩放 <span>·</span> 右键 平移 <span>·</span> F 返回漫游`:`空格 暂停 / 播放 <span>·</span> F 自由探索`}function L(e){g=e,b.enabled=e,x&&g&&(Le(x.sun),i.shadowMap.needsUpdate=!0),g?(b.update(),Q(`chapter-title`).textContent=`探索 · 你的视角`,Q(`chapter-detail`).textContent=`旋转、靠近，发现建筑的细节`):(v=-1,F()),I()}function R(e){let t=Number(e);Number.isFinite(t)&&(m=Math.max(0,Math.min(ge-.001,t)),g&&L(!1),F())}$(`正在构建建筑与立面细节…`,12),await u();let z=performance.now();O=le(),d.add(O),n.architectureMs=performance.now()-z,$(`正在种植树木，铺设道路与花园…`,35),await u(),z=performance.now();let ne=[[`地形`,36],[`道路`,38],[`种植区域`,40],[`树皮`,42],[`庭院树木`,45],[`林地树木`,48],[`灌木`,51],[`植物网格`,54],[`草坪细节`,57]],B=35;if(k=await ce(me(),{yieldControl:u,onProgress:e=>{e&&(B=Math.max(B,ne.find(([t])=>e.includes(t))?.[1]??B),$(e,B))}}),d.add(k),A=oe(),d.add(A),n.landscapeMs=performance.now()-z,$(`正在计算晴日光照…`,61),await u(),F(),N(),z=performance.now(),x=Ie(d,i),S=x.skyTarget,E=ve(k,x.sun.userData.direction),n.contextShadowMs=E.stats.bakeMs,D=Be(i,d,f),P(y,!1),Le(x.sun),i.shadowMap.needsUpdate=!0,n.lightSetupMs=performance.now()-z,await u(),bt.get(`gi`)!==`0`)try{T=yt(d,i,x,{trees:k.userData.treePositions,paths:k.userData.courtyardPaths,shrubs:k.userData.matureShrubs}),await T.bake({onProgress:e=>$(`正在计算庭院与廊下的漫反射光…`,62+e*11),yieldControl:u}),T.setEnabled(q[y].indirect),n.indirectMs=T.stats.bakeMs}catch(e){if(T?.dispose(),T=null,l)throw e;console.warn(`[campus] courtyard indirect light uses fallback`,e)}if($(`正在编译建筑与植物材质…`,74),await u(),z=performance.now(),await i.compileAsync(d,f),c.length)throw Error(`材质编译失败，请查看控制台中的 shader error。`);n.compileMs=performance.now()-z,$(`正在生成玻璃反射…`,88),await u(),z=performance.now(),d.background=x.probeBackground.texture,T?.setEnabled(!0);try{S=Re(d,i,S),await u(),O.traverse(e=>{e.material?.isMeshPhysicalMaterial&&(e.material.envMap=d.environment,e.material.needsUpdate=!0)}),C=await ce(Ve(d,i,O),{yieldControl:u,onProgress:e=>$(e,90)})}catch(e){if(l)throw e;console.warn(`[campus] reflection capture uses fallback`,e)}finally{T?.setEnabled(q[y].indirect),d.background=x.backgroundTarget.texture}if(w=Ge(d,i,O,x.probeBackground.texture),n.reflectionMs=performance.now()-z,Le(x.sun,v),i.shadowMap.needsUpdate=!0,$(`准备开始漫游…`,97),await u(),l)return;if(M(),c.length)throw Error(`画面渲染失败，请查看控制台中的 shader error。`);n.firstFrameMs=performance.now()-t;let re=0,V=0;for(let e of[O,k,A])e.traverse(e=>{e.isMesh&&(V++,re+=(e.geometry.index?.count||e.geometry.attributes.position.count)/3*(e.isInstancedMesh?e.count:1))});let H={gpu:s,triangles:re,meshes:V,timings:n,buildings:O.userData.buildingCount,landscape:k.userData.stats,contextShadow:E.stats};H.planarReflection=w.stats,console.info(`[campus] ready`,JSON.stringify(H)),Q(`loading-progress`).style.width=`100%`,xt.classList.add(`done`),window.__READY=!0,window.__ERROR=null,I();for(let e of document.querySelectorAll(`[data-quality]`))e.addEventListener(`click`,()=>P(e.dataset.quality));for(let e of document.querySelectorAll(`[data-shot]`))e.addEventListener(`click`,()=>R(e.dataset.shot*10));Q(`play`).addEventListener(`click`,()=>{g?(L(!1),h=!0):h=!h,I()}),Q(`restart`).addEventListener(`click`,()=>{R(0),h=!0,I()}),Q(`free-camera`).addEventListener(`click`,()=>L(!g)),Q(`timeline`).addEventListener(`input`,e=>R(e.target.value)),Q(`fullscreen`).addEventListener(`click`,async()=>{try{document.fullscreenElement?await document.exitFullscreen():await Q(`experience`).requestFullscreen()}catch{wt(`此浏览器未允许全屏，请使用浏览器的全屏功能。`)}}),document.addEventListener(`fullscreenchange`,()=>Q(`fullscreen`).setAttribute(`aria-label`,document.fullscreenElement?`退出全屏`:`进入全屏`)),window.addEventListener(`keydown`,e=>{/INPUT|SELECT|BUTTON|TEXTAREA/.test(e.target.tagName)||e.ctrlKey||e.altKey||e.metaKey||(e.code===`Space`&&(e.preventDefault(),Q(`play`).click()),e.key.toLowerCase()===`f`&&(e.preventDefault(),L(!g)),/^[1-6]$/.test(e.key)&&R((e.key-1)*10))}),new ResizeObserver(N).observe(r);let U=performance.now(),W=U,ae=0,G=0,K=[],fe=0;document.addEventListener(`visibilitychange`,()=>{U=performance.now(),W=U,ae=0,K=[]});function pe(e){if(l)return;let t=Math.max(0,e-U);if(U=e,!document.hidden){h&&!g&&(m=(m+Math.min(t/1e3,.1))%ge),g?(b.update(),f.position.y=Math.max(1.5,f.position.y)):F(),i.info.reset();try{if(M(),c.length)throw Error(`材质渲染失败，请重新加载或尝试其他画质档位。`)}catch(e){Tt(e);return}fe=i.info.render.calls,ae++,K.push(t),K.length>300&&K.shift(),e-W>=700&&(G=ae*1e3/(e-W),Q(`performance`).textContent=`${G.toFixed(0)} FPS · ${j.width} × ${j.height}`,ae=0,W=e),Q(`timeline`).value=String(m),Q(`elapsed`).textContent=`00:${String(Math.floor(m)).padStart(2,`0`)}`}requestAnimationFrame(pe)}window.__campus={stats:H,scene:d,camera:f,renderer:i,lighting:x,indirect:T,planarReflections:w,renderOnce:M,setTime:R,setQuality:e=>P(e,!1),setFree:L,pause:()=>{h=!1,I()},getState:()=>({quality:y,time:m,playing:h,free:g,shot:v,renderSize:j,fps:G,frameTimes:[...K],drawCalls:fe,contextLost:l,shaderErrors:[...c],camera:f.position.toArray(),target:b.target.toArray(),indirect:T?.getState()||null,stats:H})},window.addEventListener(`pagehide`,e=>{e.persisted||(C?.dispose(),w?.dispose(),S.dispose(),x.backgroundTarget.dispose(),x.probeBackground.dispose(),T?.dispose(),E?.dispose(),x.shadows?.dispose(),k.userData.contextDistricts.landuse.texture.dispose())},{once:!0}),requestAnimationFrame(pe)}Et().catch(Tt);