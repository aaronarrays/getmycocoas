if (!customElements.get("tpt-section-lazyload")) {
	customElements.define(
		"tpt-section-lazyload",
		class TptSectionLazyload extends HTMLElement {
			constructor() {
				super();

				this.elementRender = this.querySelector("[data-lazyload-element]");
			}

			connectedCallback() {
				const handleIntersection = (entries, observer) => {
					if (!entries[0].isIntersecting) return;
					observer.unobserve(this);

					fetch(this.dataset.url)
						.then((response) => response.text())
						.then((text) => {
							const responseHTML = new DOMParser().parseFromString(text, "text/html");
							const htmlSection = responseHTML.querySelector(".tpt-section").innerHTML;

							this.elementRender.innerHTML = htmlSection;
						})
						.finally(() => {
							setTimeout(() => {
								this.classList.add("tpt-section_loaded");

								// Reinjects the script tags to allow execution. By default, scripts are disabled when using element.innerHTML.
								this.querySelectorAll("script").forEach((oldScriptTag) => {
									const newScriptTag = document.createElement("script");
									Array.from(oldScriptTag.attributes).forEach((attribute) => {
										newScriptTag.setAttribute(attribute.name, attribute.value);
									});
									newScriptTag.appendChild(document.createTextNode(oldScriptTag.innerHTML));
									oldScriptTag.parentNode.replaceChild(newScriptTag, oldScriptTag);
								});
							}, 100);
						})
						.catch((e) => {
							console.error(e);
						});
				};

				new IntersectionObserver(handleIntersection.bind(this), { rootMargin: "0px 0px 200px 0px" }).observe(this);
			}
		}
	);
}
