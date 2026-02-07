class ProductRecommendations extends HTMLElement {
  /**
   * The observer for the product recommendations
   * @type {IntersectionObserver}
   */
  #intersectionObserver = new IntersectionObserver(
    (entries, observer) => {
      if (!entries[0]?.isIntersecting) return;

      console.log('[ProductRecs] IntersectionObserver: element in view, loading...');
      observer.disconnect();
      this.#loadRecommendations();
    },
    { rootMargin: '0px 0px 400px 0px' }
  );

  /**
   * Observing changes to the elements attributes
   * @type {MutationObserver}
   */
  #mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Only attribute changes are interesting
      if (mutation.target !== this || mutation.type !== 'attributes') continue;

      // Ignore error attribute changes
      if (mutation.attributeName === 'data-error') continue;

      // Ignore addition of hidden class because it means there's an error with the display
      if (mutation.attributeName === 'class' && this.classList.contains('hidden')) continue;

      // Ignore when the data-recommendations-performed attribute has been set to 'true'
      if (
        mutation.attributeName === 'data-recommendations-performed' &&
        this.dataset.recommendationsPerformed === 'true'
      )
        continue;

      // All other attribute changes trigger a reload
      this.#loadRecommendations();
      break;
    }
  });

  /**
   * The cached recommendations
   * @type {Record<string, string>}
   */
  #cachedRecommendations = {};

  /**
   * An abort controller for the active fetch (if there is one)
   * @type {AbortController | null}
   */
  #activeFetch = null;

  connectedCallback() {
    console.log('[ProductRecs] connectedCallback', this.id, 'productId=', this.dataset.productId);
    this.#intersectionObserver.observe(this);
    this.#mutationObserver.observe(this, { attributes: true });
  }

  disconnectedCallback() {
    this.#intersectionObserver.disconnect();
    this.#mutationObserver.disconnect();
  }

  /**
   * Load the product recommendations
   * When carousel: try HTML API first (preserves carousel layout), then JSON/collection
   * When grid: try JSON first, then collection, then HTML
   */
  async #loadRecommendations() {
    const { productId, recommendationsPerformed, sectionId, intent, layoutType } = this.dataset;
    const id = this.id;

    console.log('[ProductRecs] #loadRecommendations start', {
      productId,
      recommendationsPerformed,
      sectionId,
      intent,
      layoutType,
      id
    });

    if (!productId || !id) {
      console.log('[ProductRecs] ABORT: missing productId or id');
      if (!window.Shopify?.designMode) this.#handleError(new Error('Product ID is required'));
      return;
    }

    // Only skip when Liquid already rendered products; if empty (data-has-recommendations=false), run our fetch
    if (recommendationsPerformed === 'true') {
      const hasProducts = this.querySelector('.resource-list[data-has-recommendations="true"]');
      if (hasProducts) {
        console.log('[ProductRecs] SKIP: Liquid already rendered products');
        return;
      }
      console.log('[ProductRecs] recommendationsPerformed=true but no products, will fetch');
    }

    const listContainer = this.querySelector('.resource-list') || this.querySelector('[data-testid="resource-list-grid"]');
    if (!listContainer) {
      console.log('[ProductRecs] ABORT: listContainer not found');
      return;
    }
    console.log('[ProductRecs] listContainer found', {
      hasDataAttr: listContainer.getAttribute('data-has-recommendations'),
      classes: listContainer.className
    });

    const isCarousel = layoutType === 'carousel';
    console.log('[ProductRecs] isCarousel:', isCarousel);

    try {
      let success = false;

      // Skip HTML API for carousel - server often returns grid layout; build carousel from JSON instead
      if (isCarousel) {
        console.log('[ProductRecs] Carousel: skipping HTML API, using JSON/collection for correct layout');
      } else if (!isCarousel) {
        console.log('[ProductRecs] Trying HTML API first...');
        success = await this.#tryHtmlApiFirst(productId, sectionId, intent, id);
        console.log('[ProductRecs] tryHtmlApiFirst result:', success);
      }

      if (!success) {
        console.log('[ProductRecs] Trying JSON API...');
        success = await this.#fetchJsonRecommendations(productId, intent);
        console.log('[ProductRecs] fetchJsonRecommendations result:', success);
      }

      if (!success) {
        console.log('[ProductRecs] Trying collection fallback...');
        success = await this.#fetchFromCollection(productId, listContainer);
        console.log('[ProductRecs] fetchFromCollection result:', success);
      }

      if (!success) {
        console.log('[ProductRecs] Trying HTML API fallback...');
        const result = await this.#fetchCachedRecommendations(productId, sectionId, intent);
        console.log('[ProductRecs] fetchCachedRecommendations result:', result.success, 'data length:', result.data?.length);
        if (result.success) {
          const html = document.createElement('div');
          html.innerHTML = result.data || '';
          const recommendations = html.querySelector(`product-recommendations[id="${id}"]`);
          if (recommendations?.innerHTML?.trim()) {
            this.dataset.recommendationsPerformed = 'true';
            this.innerHTML = recommendations.innerHTML;
            success = true;
            console.log('[ProductRecs] HTML fallback SUCCESS');
          } else {
            console.log('[ProductRecs] HTML fallback: no product-recommendations element or empty');
          }
        }
      }

      if (success) {
        this.dataset.recommendationsPerformed = 'true';
        console.log('[ProductRecs] SUCCESS - recommendations loaded');
      } else {
        console.log('[ProductRecs] FAILED - no recommendations available');
        if (!window.Shopify?.designMode) this.#handleError(new Error('No recommendations available'));
      }
    } catch (e) {
      console.log('[ProductRecs] CATCH error:', e);
      const jsonSuccess = await this.#fetchJsonRecommendations(productId, intent);
      if (!jsonSuccess) this.#handleError(e);
    }
  }

  /**
   * Try HTML API first (for carousel - preserves server-rendered layout)
   */
  async #tryHtmlApiFirst(productId, sectionId, intent, id) {
    const result = await this.#fetchCachedRecommendations(productId, sectionId, intent);
    if (!result.success) {
      console.log('[ProductRecs] tryHtmlApiFirst: fetch failed');
      return false;
    }

    const html = document.createElement('div');
    html.innerHTML = result.data || '';
    const recommendations = html.querySelector(`product-recommendations[id="${id}"]`);
    if (!recommendations?.innerHTML?.trim()) {
      console.log('[ProductRecs] tryHtmlApiFirst: no product-recommendations[id="' + id + '"] in response');
      return false;
    }

    const hasProducts = recommendations.querySelector('[data-has-recommendations="true"]');
    if (!hasProducts) {
      console.log('[ProductRecs] tryHtmlApiFirst: HTML has no products (data-has-recommendations!=true)');
      return false;
    }

    this.dataset.recommendationsPerformed = 'true';
    this.innerHTML = recommendations.innerHTML;
    console.log('[ProductRecs] tryHtmlApiFirst: SUCCESS - using HTML from server');
    return true;
  }

  /**
   * Fallback: fetch products from collection when recommendations API returns empty
   */
  async #fetchFromCollection(productId, listContainer) {
    const baseUrl = (window.Shopify?.routes?.root || '/').replace(/\/$/, '');
    const limit = this.dataset.url?.match(/limit=(\d+)/)?.[1] || 4;
    const collectionHandle = this.dataset.collectionHandle || 'all';

    const url = `${baseUrl}/collections/${collectionHandle}/products.json?limit=${limit}`;
    console.log('[ProductRecs] fetchFromCollection URL:', url);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.log('[ProductRecs] fetchFromCollection: response not ok', response.status);
        return false;
      }

      const { products } = await response.json();
      console.log('[ProductRecs] fetchFromCollection: got', products?.length || 0, 'products');

      if (!products?.length) return false;

      const filtered = products.filter((p) => String(p.id) !== String(productId));
      console.log('[ProductRecs] fetchFromCollection: after filter', filtered.length, 'products');

      if (!filtered.length) return false;

      this.#renderProductCards(listContainer, filtered.slice(0, parseInt(limit, 10)), this.dataset.layoutType);
      return true;
    } catch (err) {
      console.log('[ProductRecs] fetchFromCollection CATCH:', err);
      return false;
    }
  }

  /**
   * Render product cards HTML into container
   * Uses theme structure: resource-list__item > product-card > link + content
   * When layout is carousel, builds full slideshow structure
   */
  #renderProductCards(listContainer, products, layoutType = 'grid') {
    console.log('[ProductRecs] #renderProductCards', { productsCount: products.length, layoutType });

    const formatPrice = (value) => {
      if (value == null) return '';
      if (typeof value === 'string') return value;
      return (value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const cardHtml = (product) => {
      const img = product.featured_image ?? product.images?.[0] ?? product.variants?.[0]?.featured_image;
      const imgUrl = typeof img === 'string' ? img : (img?.src ?? img?.url ?? '');
      const root = (window.Shopify?.routes?.root || '/').replace(/\/$/, '');
      const productUrl = product.url ?? (product.handle ? `${root}/products/${product.handle}` : '#');
      const title = (product.title || '').replace(/"/g, '&quot;');
      const comparePrice = product.compare_at_price ?? 0;
      const price = product.price ?? 0;
      const hasSale = comparePrice > price;
      return `
        <div class="resource-list__item">
          <div class="product-card">
            <a href="${productUrl}" class="product-card__link" aria-label="${title}">
              <span class="visually-hidden">${title}</span>
            </a>
            <div class="product-card__content layout-panel-flex layout-panel-flex--column product-grid__card gap-style" style="--product-card-gap: 4px;">
              <div class="card-gallery" style="aspect-ratio: 1; overflow: hidden; position: relative;">
                <img
                  src="${imgUrl}"
                  alt="${title}"
                  loading="lazy"
                  width="400"
                  height="400"
                  style="width:100%;height:100%;object-fit:contain;"
                />
              </div>
              <h4 class="h4" style="margin:0;font-size:1rem;">${product.title || ''}</h4>
              <div class="price">
                <span class="price__regular">${formatPrice(price)}</span>
                ${hasSale ? `<s class="price__sale" style="margin-left:0.5rem;opacity:0.7;">${formatPrice(comparePrice)}</s>` : ''}
              </div>
            </div>
          </div>
        </div>
      `;
    };

    if (layoutType === 'carousel') {
      listContainer.innerHTML = this.#buildCarouselHtml(products, cardHtml);
      listContainer.classList.remove('resource-list--grid');
      listContainer.classList.add('resource-list__carousel', 'force-full-width');
    } else {
      listContainer.innerHTML = products.map(cardHtml).join('');
      listContainer.classList.remove('resource-list__carousel', 'force-full-width');
      listContainer.classList.add('resource-list--grid');
    }

    listContainer.setAttribute('data-has-recommendations', 'true');
    console.log('[ProductRecs] #renderProductCards DONE, layoutType=', layoutType);
  }

  /**
   * Build carousel HTML structure with slideshow-component
   */
  #buildCarouselHtml(products, cardHtml) {
    const iconsStyle = this.dataset.iconsStyle || 'arrow';
    const iconsShape = this.dataset.iconsShape || 'none';
    const sectionWidth = this.dataset.sectionWidth || 'page-width';
    const columns = this.dataset.columns || '4';
    const showArrows = iconsStyle !== 'none';
    const gutterStyle = sectionWidth === 'page-width'
      ? '--gutter-slide-width: var(--util-page-margin-offset);'
      : '--gutter-slide-width: 0px;';
    const slideshowGutters = sectionWidth === 'page-width' ? 'start end' : '';

    const timelineScope = products.map((_, i) => `--slide-${i}`).join(', ');

    const slides = products
      .map((product, i) => {
        const children = cardHtml(product);
        return `<slideshow-slide ref="slides[]" slide-id="slide-${i}" aria-hidden="${i === 0 ? 'false' : 'true'}" class="resource-list__slide" style="--slideshow-timeline: --slide-${i};">${children}</slideshow-slide>`;
      })
      .join('');

    const shapeClass = iconsShape && iconsShape !== 'none' ? ` slideshow-control--shape-${iconsShape}` : '';
    const styleClass = ` slideshow-control--style-${iconsStyle}`;
    const arrowSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="var(--icon-stroke-width)" vector-effect="non-scaling-stroke" d="M4.25 10h11.5m0 0-4-4m4 4-4 4"/></svg>';
    const arrowsHtml = showArrows
      ? `<slideshow-arrows position="center"><button type="button" class="slideshow-control slideshow-control--previous${shapeClass}${styleClass} button button-unstyled button-unstyled--transparent flip-x" ref="previous" on:click="/previous" aria-label="Previous"><span class="svg-wrapper icon-arrow">${arrowSvg}</span></button><button type="button" class="slideshow-control slideshow-control--next${shapeClass}${styleClass} button button-unstyled button-unstyled--transparent" ref="next" on:click="/next" aria-label="Next"><span class="svg-wrapper icon-arrow">${arrowSvg}</span></button></slideshow-arrows>`
      : '';

    return `
      <div class="resource-list__carousel" style="${gutterStyle} --slide-width-max: 300px;">
        <slideshow-component
          class="resource-list__carousel"
          style="--slideshow-timeline: ${timelineScope};"
          initial-slide="0"
          ${showArrows ? '' : 'infinite'}
        >
          <slideshow-container ref="slideshowContainer">
            ${arrowsHtml}
            <slideshow-slides tabindex="-1" ref="scroller" ${slideshowGutters ? `gutters="${slideshowGutters}"` : ''}>
              ${slides}
            </slideshow-slides>
          </slideshow-container>
        </slideshow-component>
      </div>
    `;
  }

  /**
   * Fetch recommendations via JSON API and render product cards
   */
  async #fetchJsonRecommendations(productId, intent) {
    const baseUrl = (window.Shopify?.routes?.root || '/').replace(/\/$/, '');
    const limit = this.dataset.url?.match(/limit=(\d+)/)?.[1] || 4;
    const url = `${baseUrl}/recommendations/products.json?product_id=${productId}&limit=${limit}&intent=${intent || 'related'}`;

    console.log('[ProductRecs] fetchJsonRecommendations URL:', url);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.log('[ProductRecs] fetchJsonRecommendations: response not ok', response.status);
        return false;
      }

      const { products } = await response.json();
      console.log('[ProductRecs] fetchJsonRecommendations: got', products?.length || 0, 'products');

      if (!products?.length) return false;

      const listContainer = this.querySelector('.resource-list') || this.querySelector('[data-testid="resource-list-grid"]');
      if (!listContainer) {
        console.log('[ProductRecs] fetchJsonRecommendations: listContainer not found');
        return false;
      }

      this.#renderProductCards(listContainer, products, this.dataset.layoutType);
      return true;
    } catch (err) {
      console.log('[ProductRecs] fetchJsonRecommendations CATCH:', err);
      return false;
    }
  }

  /**
   * Fetches the recommendations and cached the result for future use
   * @param {string} productId
   * @param {string | undefined} sectionId
   * @param {string | undefined} intent
   * @returns {Promise<{ success: true, data: string } | { success: false, status: number }>}
   */
  async #fetchCachedRecommendations(productId, sectionId, intent) {
    const urlsToTry = [
      `${this.dataset.url}&product_id=${productId}&section_id=${sectionId || 'product-recommendations'}&intent=${intent}`,
      sectionId && sectionId !== 'product-recommendations'
        ? `${this.dataset.url}&product_id=${productId}&section_id=product-recommendations&intent=${intent}`
        : null
    ].filter(Boolean);

    console.log('[ProductRecs] fetchCachedRecommendations URLs:', urlsToTry);

    for (const url of urlsToTry) {
      const cachedResponse = this.#cachedRecommendations[url];
      if (cachedResponse) {
        console.log('[ProductRecs] fetchCachedRecommendations: cache HIT');
        return { success: true, data: cachedResponse };
      }

      this.#activeFetch?.abort();
      this.#activeFetch = new AbortController();

      try {
        const response = await fetch(url, { signal: this.#activeFetch.signal });
        console.log('[ProductRecs] fetchCachedRecommendations:', url, 'status=', response.status);
        if (response.ok) {
          const text = await response.text();
          this.#cachedRecommendations[url] = text;
          return { success: true, data: text };
        }
      } catch (err) {
        console.log('[ProductRecs] fetchCachedRecommendations CATCH:', err);
      } finally {
        this.#activeFetch = null;
      }
    }
    return { success: false, status: 404 };
  }

  /**
   * Handle errors in a consistent way
   * @param {Error} error
   */
  #handleError(error) {
    console.error('Product recommendations error:', error.message);
    this.classList.add('hidden');
    this.dataset.error = 'Error loading product recommendations';
  }
}

if (!customElements.get('product-recommendations')) {
  customElements.define('product-recommendations', ProductRecommendations);
}
