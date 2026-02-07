class ProductRecommendations extends HTMLElement {
  /**
   * The observer for the product recommendations
   * @type {IntersectionObserver}
   */
  #intersectionObserver = new IntersectionObserver(
    (entries, observer) => {
      if (!entries[0]?.isIntersecting) return;

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
    this.#intersectionObserver.observe(this);
    this.#mutationObserver.observe(this, { attributes: true });
  }

  disconnectedCallback() {
    this.#intersectionObserver.disconnect();
    this.#mutationObserver.disconnect();
  }

  /**
   * Load the product recommendations
   * Uses JSON API first (more reliable), then HTML section as fallback
   */
  async #loadRecommendations() {
    const { productId, recommendationsPerformed, sectionId, intent } = this.dataset;
    const id = this.id;

    if (!productId || !id) {
      if (!window.Shopify?.designMode) this.#handleError(new Error('Product ID is required'));
      return;
    }

    if (recommendationsPerformed === 'true') return;

    const listContainer = this.querySelector('.resource-list') || this.querySelector('[data-testid="resource-list-grid"]');
    if (!listContainer) return;

    try {
      let success = await this.#fetchJsonRecommendations(productId, intent);

      if (!success) {
        success = await this.#fetchFromCollection(productId, listContainer);
      }

      if (!success) {
        const result = await this.#fetchCachedRecommendations(productId, sectionId, intent);
        if (result.success) {
          const html = document.createElement('div');
          html.innerHTML = result.data || '';
          const recommendations = html.querySelector(`product-recommendations[id="${id}"]`);
          if (recommendations?.innerHTML?.trim()) {
            this.dataset.recommendationsPerformed = 'true';
            this.innerHTML = recommendations.innerHTML;
            success = true;
          }
        }
      }

      if (success) {
        this.dataset.recommendationsPerformed = 'true';
      } else if (!window.Shopify?.designMode) {
        this.#handleError(new Error('No recommendations available'));
      }
    } catch (e) {
      const jsonSuccess = await this.#fetchJsonRecommendations(productId, intent);
      if (!jsonSuccess) this.#handleError(e);
    }
  }

  /**
   * Fallback: fetch products from collection when recommendations API returns empty
   */
  async #fetchFromCollection(productId, listContainer) {
    const baseUrl = window.Shopify?.routes?.root || '/';
    const limit = this.dataset.url?.match(/limit=(\d+)/)?.[1] || 4;
    const collectionHandle = this.dataset.collectionHandle || 'all';

    try {
      const url = `${baseUrl}collections/${collectionHandle}/products.json?limit=${limit}`;
      const response = await fetch(url);
      if (!response.ok) return false;

      const { products } = await response.json();
      if (!products?.length) return false;

      const filtered = products.filter((p) => String(p.id) !== String(productId));
      if (!filtered.length) return false;

      this.#renderProductCards(listContainer, filtered.slice(0, parseInt(limit, 10)));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Render product cards HTML into container
   */
  #renderProductCards(listContainer, products) {
    const formatPrice = (value) => {
      if (value == null) return '';
      if (typeof value === 'string') return value;
      return (value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    listContainer.innerHTML = products
      .map((product) => {
        const img = product.featured_image ?? product.images?.[0] ?? product.variants?.[0]?.featured_image;
        const imgUrl = typeof img === 'string' ? img : (img?.src ?? img?.url ?? '');
        const root = (window.Shopify?.routes?.root || '/').replace(/\/$/, '');
        const productUrl = product.url ?? (product.handle ? `${root}/products/${product.handle}` : '#');
        return `
          <div class="resource-list__item">
            <a href="${productUrl}" class="product-card__link" style="display:block;text-decoration:none;color:inherit;">
              <div class="product-card__media" style="aspect-ratio:1;overflow:hidden;">
                <img
                  src="${imgUrl}"
                  alt="${(product.title || '').replace(/"/g, '&quot;')}"
                  loading="lazy"
                  width="400"
                  height="400"
                  style="width:100%;height:100%;object-fit:contain;"
                />
              </div>
              <div class="product-card__content" style="padding:1rem 0;">
                <h3 class="product-card__title" style="margin:0 0 0.5rem;font-size:1rem;">${product.title || ''}</h3>
                <div class="price">
                  <span class="price__regular">${formatPrice(product.price)}</span>
                  ${product.compare_at_price > product.price ? `<s class="price__sale" style="margin-left:0.5rem;opacity:0.7;">${formatPrice(product.compare_at_price)}</s>` : ''}
                </div>
              </div>
            </a>
          </div>
        `;
      })
      .join('');

    listContainer.setAttribute('data-has-recommendations', 'true');
  }

  /**
   * Fetch recommendations via JSON API and render product cards
   */
  async #fetchJsonRecommendations(productId, intent) {
    const baseUrl = window.Shopify?.routes?.root || '/';
    const limit = this.dataset.url?.match(/limit=(\d+)/)?.[1] || 4;
    const url = `${baseUrl}recommendations/products.json?product_id=${productId}&limit=${limit}&intent=${intent || 'related'}`;

    try {
      const response = await fetch(url);
      if (!response.ok) return false;

      const { products } = await response.json();
      if (!products?.length) return false;

      const listContainer = this.querySelector('.resource-list') || this.querySelector('[data-testid="resource-list-grid"]');
      if (!listContainer) return false;

      this.#renderProductCards(listContainer, products);
      return true;
    } catch {
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

    for (const url of urlsToTry) {
      const cachedResponse = this.#cachedRecommendations[url];
      if (cachedResponse) {
        return { success: true, data: cachedResponse };
      }

      this.#activeFetch?.abort();
      this.#activeFetch = new AbortController();

      try {
        const response = await fetch(url, { signal: this.#activeFetch.signal });
        if (response.ok) {
          const text = await response.text();
          this.#cachedRecommendations[url] = text;
          return { success: true, data: text };
        }
      } catch {
        /* try next url */
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
