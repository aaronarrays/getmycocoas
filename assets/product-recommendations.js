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
   */
  #loadRecommendations() {
    const { productId, recommendationsPerformed, sectionId, intent } = this.dataset;
    const id = this.id;

    if (!productId || !id) {
      throw new Error('Product ID and an ID attribute are required');
    }

    // If the recommendations have already been loaded, accounts for the case where the Theme Editor
    // is loaded the section from the editor's visual preview context.
    if (recommendationsPerformed === 'true') {
      return;
    }

    this.#fetchCachedRecommendations(productId, sectionId, intent)
      .then(async (result) => {
        if (!result.success) {
          const jsonSuccess = await this.#fetchJsonRecommendations(productId, intent);
          if (!jsonSuccess && !window.Shopify?.designMode) this.#handleError(new Error(`Server returned ${result.status}`));
          return;
        }

        const html = document.createElement('div');
        html.innerHTML = result.data || '';
        const recommendations = html.querySelector(`product-recommendations[id="${id}"]`);

        if (recommendations?.innerHTML && recommendations.innerHTML.trim().length) {
          this.dataset.recommendationsPerformed = 'true';
          this.innerHTML = recommendations.innerHTML;
          return;
        }

        const jsonSuccess = await this.#fetchJsonRecommendations(productId, intent);
        if (!jsonSuccess) this.#handleError(new Error('No recommendations available'));
      })
      .catch((e) => {
        this.#fetchJsonRecommendations(productId, this.dataset.intent || 'related').then((success) => {
          if (!success) this.#handleError(e);
        }).catch(() => this.#handleError(e));
      });
  }

  /**
   * Fallback: fetch recommendations via JSON API and render product cards
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

      const formatPrice = (value) => {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        return (value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      };

      listContainer.innerHTML = products
        .map(
          (product) => {
            const img = product.featured_image ?? product.images?.[0] ?? product.variants?.[0]?.featured_image;
            const imgUrl = typeof img === 'string' ? img : (img?.src ?? img?.url ?? '');
            const productUrl = product.url ?? (product.handle ? `/products/${product.handle}` : '#');
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
          }
        )
        .join('');

      listContainer.setAttribute('data-has-recommendations', 'true');
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
