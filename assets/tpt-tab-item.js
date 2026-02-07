
if (!customElements.get('tpt-tab-item')) {
	class TabItem extends HTMLElement {
		constructor() {
			super();
			this.addEventListener('click', this.displayTabContainer.bind(this));
			this.addEventListener('keypress', this.keyPress.bind(this));
		}
	
		keyPress(event) {
			if (event.key === 'Enter') {
				this.displayTabContainer(event);
			}
		}
	
		displayTabContainer(event) {
			event.preventDefault();
			const tabContainerTarget = this.getAttribute('data-tab-target');
			const tabAjaxUrl = this.getAttribute('data-ajax-url');
			if (tabAjaxUrl && !this.classList.contains('loaded')) {
				this.closest('tpt-tabs-component').classList.add('component-loading');
	
				const currentTabContainer = this.closest('tpt-tabs-component');
				const tabContainerTarget = this.getAttribute('data-tab-target');
				currentTabContainer.querySelectorAll('tpt-tab-item').forEach((element) => {
					element.classList.remove('active');
				});
				this.classList.add('loading');
	
				if (this.classList.contains('active')) {
					return;
				} else {
					const ajaxDataElement = this.closest('tpt-tabs-component').querySelector('[data-ajax-content="' + tabContainerTarget + '"]');
					this.classList.add('active');
					fetch(tabAjaxUrl)
						.then((response) => response.text())
						.then((responseText) => {
							const elementToGet = this.getAttribute('data-ajax-element');
	
							const responseHTML = new DOMParser().parseFromString(responseText, 'text/html');
	
							if (elementToGet) {
								const tabContentHtml = responseHTML.querySelector(elementToGet);
								ajaxDataElement.innerHTML = tabContentHtml.innerHTML;
							} else {
								ajaxDataElement.innerHTML = responseText;
							}
						})
						.finally(() => {
							this.activeTabContainer();
							this.classList.add('loaded');
							this.classList.remove('loading');
							this.closest('tpt-tabs-component').classList.remove('component-loading');
							this.activeSwiper(this);
						});
				}
			} else {
				if (this.classList.contains('active')) {
					return;
				} else {
					this.activeTabContainer();
				}
			}
		}
	
		activeTabContainer() {
			const currentTabContainer = this.closest('tpt-tabs-component');
			const tabContainerTarget = this.getAttribute('data-tab-target');
	
			currentTabContainer.querySelectorAll('tpt-tab-item').forEach((element) => {
				element.classList.remove('active');
			});
	
			this.classList.add('active');
	
			currentTabContainer.querySelectorAll('tpt-tab-data').forEach((element) => {
				element.classList.remove('active');
			});
	
			currentTabContainer.querySelector('[data-tab-container="' + tabContainerTarget + '"]').classList.add('active');
		}
		activeSwiper(tabItem) {
			const productTabContainer = tabItem.closest('.product-tab-container');
			const swiperSlide = productTabContainer.closest('tpt-slider');
			const swipperContainer = productTabContainer.querySelector('.active .tpt-swiper-container');
	
			// const swipperContainer = document.querySelector('.active .tpt-swiper-container');
			if(swipperContainer){
				const swiper = swipperContainer.querySelector('.swiper');
				const optionString = swiperSlide.querySelector('tpt-slider-options').innerHTML;
				const optionsJson = JSON.parse(optionString);
				const nextButton = swipperContainer.querySelector('.swiper-button-next');
				const prevButton = swipperContainer.querySelector('.swiper-button-prev');
				const pagination = swipperContainer.querySelector('.swiper-paginations');
		
				if (pagination) {
					optionsJson.pagination.el = pagination;
					optionsJson.pagination.clickable = true;
				}
		
				let options = {
					...optionsJson,
					navigation: {
						nextEl: nextButton,
						prevEl: prevButton,
					},
				};
		
				// CUSTOM BULLET
				if (optionsJson.pagination.type == 'custom') {
					options['pagination'] = {
						el: pagination,
						clickable: true,
						renderBullet: function (index, className) {
							return '<span class="' + className + '">' + (index + 1) + '</span>';
						},
					};
				}
				// CUSTOM BULLET
		
				new Swiper(swiper, options);
			}
			
		}}
	customElements.define('tpt-tab-item', TabItem);
}