function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Demo Scenario Text Database
const DEMO_TEXTS = {
  'sales-marketing-conflict': `CONCORDE ENTERPRISES - LEAD INTEGRATION RULES
Marketing expects automatic lead qualification based on web activity. However, Sales requires manual approval for every lead to prevent CRM clutter. No final decision owner is identified in the notes, and there are no quantitative success metrics defined for conversion quality.`,

  'ai-support-rollout': `AI CUSTOMER-SUPPORT ROLLOUT DECK
Leadership expects autonomous AI responses directly to customers to cut costs. Legal requires manual human review before any customer communication to prevent liability. The implementation schedule does not include review staffing. Success metrics are described only as 'improved customer experience'.`,

  'multi-location-operations': `MULTI-LOCATION OPERATIONS MANUAL
Corporate expects standardized workflows across all branches to normalize statistics. Regional managers require local customization to adapt to unique local legal requirements. Required data fields differ between locations. Training ownership and rollout sequencing are undefined.`
};

// Global App State
const App = {
  config: null,
  projectName: 'Customer AI Rollout',
  analysisProfile: 'general',
  activeScenarioId: 'sales-marketing-conflict',
  activeProvider: 'demo',
  originalResult: null,
  currentResult: null,

  async init() {
    this.bindEvents();
    
    // Set initial text
    document.getElementById('doc-text').value = DEMO_TEXTS[this.activeScenarioId];
    
    // Fetch active provider status
    try {
      const healthRes = await fetch('/api/health');
      if (healthRes.ok) {
        const healthData = await healthRes.json();
        this.activeProvider = healthData.activeProvider;
        const providerBadge = document.getElementById('provider-badge');
        if (providerBadge) {
          if (this.activeProvider === 'demo') {
            providerBadge.textContent = 'Analysis mode: Deterministic demo fixtures';
          } else if (this.activeProvider === 'gemini') {
            providerBadge.textContent = 'Analysis mode: Gemini structured analysis';
          } else {
            providerBadge.textContent = `Analysis mode: ${this.activeProvider}`;
          }
        }
      }
    } catch (err) {
      console.warn('Could not fetch active provider status', err.message);
      this.activeProvider = 'demo';
    }

    // Fetch Configuration from server
    try {
      const response = await fetch('/config.json');
      if (response.ok) {
        this.config = await response.json();
      } else {
        throw new Error('Response code ' + response.status);
      }
    } catch (err) {
      console.warn('Could not fetch config.json from server, loading fallback configuration.', err.message);
      this.config = {
        baseScore: 100,
        categories: [
          "stakeholder-conflict", "missing-ownership", "undefined-metrics", "unclear-handoffs",
          "data-dependency", "configuration-dependency", "unvalidated-assumptions", "scope-ambiguity",
          "adoption-risk", "compliance-risk"
        ],
        severities: ["critical", "high", "medium", "low"],
        penalties: {
          severity: { critical: 15, high: 8, medium: 4, low: 1 },
          unconfirmedOwner: 3,
          undefinedMetric: 5,
          unresolvedStakeholderConflict: 5,
          missingDependency: 4
        },
        residualPenaltyMultiplier: 0.50,
        classifications: [
          { min: 85, max: 100, label: "Ready with minor controls", class: "ready" },
          { min: 70, max: 84, label: "Conditionally ready", class: "conditional" },
          { min: 50, max: 69, label: "Significant preparation required", class: "preparation" },
          { min: 0, max: 49, label: "High implementation risk", class: "risk" }
        ]
      };
    }
  },

  bindEvents() {
    // Preset buttons
    const presetBtns = document.querySelectorAll('.btn-preset');
    presetBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        presetBtns.forEach(b => b.classList.remove('active-preset'));
        btn.classList.add('active-preset');
        this.activeScenarioId = btn.dataset.scenario;
        document.getElementById('doc-text').value = DEMO_TEXTS[this.activeScenarioId];
        
        // Auto-change project name based on scenario
        const projInput = document.getElementById('project-name');
        if (this.activeScenarioId === 'sales-marketing-conflict') {
          projInput.value = 'Sales & Marketing CRM Sync';
        } else if (this.activeScenarioId === 'ai-support-rollout') {
          projInput.value = 'AI Support Agent Rollout';
        } else if (this.activeScenarioId === 'multi-location-operations') {
          projInput.value = 'Global Operations Standardization';
        }
      });
    });

    // Clear scenario ID on user editing textarea content
    document.getElementById('doc-text').addEventListener('input', () => {
      presetBtns.forEach(b => b.classList.remove('active-preset'));
      this.activeScenarioId = null;
    });

    // Scan button
    const scanBtn = document.getElementById('btn-scan');
    scanBtn.addEventListener('click', () => {
      this.runScanPipeline();
    });

    // Print button
    const printBtn = document.getElementById('btn-print');
    printBtn.addEventListener('click', () => {
      // Sync meta text for print view
      document.getElementById('print-meta-project').textContent = document.getElementById('project-name').value;
      
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('print-meta-date').textContent = today;
      
      const profileSelect = document.getElementById('analysis-profile');
      document.getElementById('print-meta-profile').textContent = profileSelect.options[profileSelect.selectedIndex].text;
      
      const score = document.getElementById('score-display').textContent;
      const classification = document.getElementById('classification-display').textContent;
      document.getElementById('print-meta-readiness').textContent = `${score}/100 (${classification})`;
      
      window.print();
    });

    // Tab buttons with arrow keyboard accessibility
    const tabBtns = document.querySelectorAll('.tab-button');
    tabBtns.forEach((btn, index) => {
      btn.addEventListener('click', () => {
        this.activateTab(index, false); // click activates tab panel but does not force focus
      });

      btn.addEventListener('keydown', (e) => {
        let targetIndex = null;
        if (e.key === 'ArrowRight') {
          targetIndex = (index + 1) % tabBtns.length;
        } else if (e.key === 'ArrowLeft') {
          targetIndex = (index - 1 + tabBtns.length) % tabBtns.length;
        } else if (e.key === 'Home') {
          targetIndex = 0;
        } else if (e.key === 'End') {
          targetIndex = tabBtns.length - 1;
        } else if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          this.activateTab(index, true); // Space/Enter activates and forces focus to the panel
        }

        if (targetIndex !== null) {
          e.preventDefault();
          tabBtns[targetIndex].focus();
          this.activateTab(targetIndex, false);
        }
      });
    });

    // Filters for Risk Register
    document.getElementById('filter-severity').addEventListener('change', () => this.filterRiskCards());
    document.getElementById('filter-category').addEventListener('change', () => this.filterRiskCards());
    document.getElementById('filter-status').addEventListener('change', () => this.filterRiskCards());
  },

  activateTab(index, focusPanel = false) {
    const tabBtns = document.querySelectorAll('.tab-button');
    const sections = document.querySelectorAll('.tab-section');
    
    tabBtns.forEach((btn, i) => {
      const sectionId = `sec-${btn.dataset.section}`;
      const sec = document.getElementById(sectionId);
      
      if (i === index) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        btn.setAttribute('tabindex', '0');
        
        if (sec) {
          sec.classList.add('active-section');
          if (focusPanel) {
            sec.focus();
          }
        }
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
        btn.setAttribute('tabindex', '-1');
        
        if (sec) {
          sec.classList.remove('active-section');
        }
      }
    });
  },

  async runScanPipeline() {
    const textVal = document.getElementById('doc-text').value.trim();
    if (!textVal) {
      alert('Please enter some source text to analyze.');
      return;
    }

    // Toggle states
    document.getElementById('btn-scan').disabled = true;
    document.getElementById('pipeline-panel').style.display = 'flex';
    document.getElementById('results-empty').style.display = 'none';
    document.getElementById('results-dashboard').style.display = 'none';

    // Simulated scanner progress pipeline (120ms per step)
    const steps = [
      'step-1', 'step-2', 'step-3', 'step-4',
      'step-5', 'step-6', 'step-7', 'step-8'
    ];
    
    // Clear step states
    steps.forEach(id => {
      const el = document.getElementById(id);
      el.classList.remove('active', 'done');
      el.querySelector('.step-status').textContent = '⏳';
    });

    const statusEl = document.getElementById('scan-status');

    for (let i = 0; i < steps.length; i++) {
      const stepId = steps[i];
      const el = document.getElementById(stepId);
      const stepText = el.querySelector('span').textContent;
      if (statusEl) {
        statusEl.textContent = `Step ${i + 1} of 8: ${stepText}.`;
      }
      el.classList.add('active');
      await new Promise(r => setTimeout(r, 120));
      el.classList.remove('active');
      el.classList.add('done');
      el.querySelector('.step-status').textContent = '✓';
    }

    if (statusEl) {
      statusEl.textContent = 'Scan completed successfully.';
    }

    // Call API
    try {
      const payload = {
        demoScenarioId: this.activeScenarioId,
        analysisProfile: document.getElementById('analysis-profile').value,
        text: textVal,
        projectName: document.getElementById('project-name').value
      };

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Server returned error code ' + response.status);
      }

      const result = await response.json();
      
      // Keep clone of original for validation
      this.originalResult = JSON.parse(JSON.stringify(result));
      this.currentResult = JSON.parse(JSON.stringify(result));

      // Calculate score and render dashboard
      this.recalculateReadinessScore();
      this.renderDashboard();
      
      document.getElementById('pipeline-panel').style.display = 'none';
      document.getElementById('results-dashboard').style.display = 'block';

    } catch (err) {
      alert(`Scan Failure: ${err.message}`);
      document.getElementById('btn-scan').disabled = false;
      document.getElementById('pipeline-panel').style.display = 'none';
      document.getElementById('results-empty').style.display = 'flex';
    } finally {
      document.getElementById('btn-scan').disabled = false;
    }
  },

  recalculateReadinessScore() {
    if (!this.currentResult) return;

    // Delegate calculation to shared ScoringEngine
    const res = window.ScoringEngine.calculateScore(this.currentResult, this.config);
    this.currentResult.computedScore = res.finalScore;
    this.currentResult.calculatedScore = res.calculatedScore;
    this.currentResult.gateCap = res.gateCap;
    this.currentResult.gateAdjustment = res.gateAdjustment;
    this.currentResult.gateReason = res.gateReason;
    this.currentResult.gateApplied = res.gateAdjustment > 0;
    this.currentResult.computedClassification = res.classification;
    this.currentResult.computedPenalties = res.penaltiesList;
  },

  renderDashboard() {
    if (!this.currentResult) return;

    // 1. Render Score Index Card
    const score = this.currentResult.computedScore;
    const classification = this.currentResult.computedClassification;
    
    document.getElementById('score-display').textContent = score;
    document.getElementById('classification-display').textContent = classification.label;
    
    const barFill = document.getElementById('score-bar-fill');
    barFill.className = 'score-bar-fill'; // reset
    if (classification.class === 'ready') barFill.classList.add('fill-green');
    else if (classification.class === 'conditional') barFill.classList.add('fill-amber');
    else if (classification.class === 'preparation') barFill.classList.add('fill-amber');
    else barFill.classList.add('fill-red');
    barFill.style.width = `${score}%`;

    // Render Blocker Gate Info Card
    const gateInfoEl = document.getElementById('score-gate-info');
    if (gateInfoEl) {
      if (this.currentResult.gateApplied) {
        gateInfoEl.style.display = 'block';
        gateInfoEl.innerHTML = `
          <strong>Critical-blocker cap applied: ${escapeHTML(this.currentResult.computedScore)}</strong> (calculated score: ${escapeHTML(this.currentResult.calculatedScore)})<br>
          <small>${escapeHTML(this.currentResult.gateReason)}</small>
        `;
      } else {
        gateInfoEl.style.display = 'none';
      }
    }

    // 2. Render Score Penalty Table
    const penaltyBody = document.getElementById('penalty-breakdown-body');
    penaltyBody.innerHTML = '';
    
    if (this.currentResult.computedPenalties.length === 0 && this.currentResult.gateAdjustment === 0) {
      penaltyBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-green);">No active penalties. System ready.</td></tr>`;
    } else {
      this.currentResult.computedPenalties.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${escapeHTML(p.factor)}</strong></td>
          <td>${escapeHTML(p.basePenalty)}</td>
          <td><span class="badge ${p.status.includes('Resolved') && !p.status.includes('Missing') && !p.status.includes('Incomplete') ? 'badge-green' : p.status.includes('Accepted') ? 'badge-purple' : 'badge-amber'}">${escapeHTML(p.status)}</span></td>
          <td style="color: var(--color-red); font-weight:700;">${escapeHTML(p.current)}</td>
        `;
        penaltyBody.appendChild(tr);
      });

      if (this.currentResult.gateAdjustment > 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong style="color:var(--color-red);">Gate Cap Adjustment</strong></td>
          <td>-</td>
          <td><span class="badge badge-red">Blocker Capped</span></td>
          <td style="color: var(--color-red); font-weight:700;">-${escapeHTML(this.currentResult.gateAdjustment)}</td>
        `;
        penaltyBody.appendChild(tr);
      }
    }

    // 3. Render Executive Quick Read
    document.getElementById('consequences-display').textContent = this.currentResult.summary;
    document.getElementById('next-step-display').textContent = this.currentResult.topBlockers[0] || 'Schedule project alignment workshop.';

    // 4. Render Risk Cards
    this.renderRiskRegister();

    // 5. Render Stakeholders
    const stakeholderBody = document.getElementById('stakeholder-table-body');
    stakeholderBody.innerHTML = '';
    this.currentResult.stakeholders.forEach(sh => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHTML(sh.name)}</strong><br><small style="color:var(--text-muted);">${escapeHTML(sh.role)}</small></td>
        <td><ul style="padding-left:1rem;">${sh.goals.map(g => `<li>${escapeHTML(g)}</li>`).join('')}</ul></td>
        <td style="color:var(--color-red);"><ul style="padding-left:1rem;">${sh.conflicts.map(c => `<li>${escapeHTML(c)}</li>`).join('')}</ul></td>
        <td>${escapeHTML(sh.authority)}</td>
      `;
      stakeholderBody.appendChild(tr);
    });

    // 6. Render Dependency Matrix
    const renderDependencyList = (elId, filterType) => {
      const el = document.getElementById(elId);
      el.innerHTML = '';
      const filteredDeps = this.currentResult.dependencies.filter(d => d.type.startsWith(filterType));
      
      if (filteredDeps.length === 0) {
        el.innerHTML = `<p style="color:var(--text-muted); font-size:0.75rem;">None identified.</p>`;
      } else {
        filteredDeps.forEach(dep => {
          const div = document.createElement('div');
          div.className = `dep-item status-${escapeHTML(dep.status)}`;
          div.innerHTML = `
            <div class="dep-item-header">
              <strong>${escapeHTML(dep.name)}</strong>
              <span class="badge ${dep.status === 'resolved' ? 'badge-green' : 'badge-red'}">${escapeHTML(dep.status)}</span>
            </div>
            <p>${escapeHTML(dep.description)}</p>
            <div style="margin-top: 0.5rem; display:flex; gap:0.5rem;">
              <button class="btn btn-secondary" style="padding:0.15rem 0.4rem; font-size:0.65rem;">
                Mark ${dep.status === 'resolved' ? 'Missing' : 'Resolved'}
              </button>
            </div>
          `;
          
          const btn = div.querySelector('button');
          btn.addEventListener('click', () => {
            App.toggleDependencyStatus(dep.name);
          });
          
          el.appendChild(div);
        });
      }
    };

    renderDependencyList('dep-list-data', 'data');
    renderDependencyList('dep-list-technical', 'technical');
    renderDependencyList('dep-list-configuration', 'configuration');
    renderDependencyList('dep-list-people', 'people');
    renderDependencyList('dep-list-people', 'policy'); // combine people and policy

    // 7. Render Decisions Required
    const decisionBody = document.getElementById('decision-table-body');
    decisionBody.innerHTML = '';
    this.currentResult.decisions.forEach(dec => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHTML(dec.decision)}</strong></td>
        <td><span class="badge badge-purple">${escapeHTML(dec.suggestedOwner)}</span></td>
        <td>${dec.relatedRisks.map(r => escapeHTML(r)).join(', ')}</td>
        <td style="color:var(--color-red);">${escapeHTML(dec.consequence)}</td>
      `;
      decisionBody.appendChild(tr);
    });

    // 8. Render Validation Questions
    const validationBody = document.getElementById('validation-questions-body');
    validationBody.innerHTML = '';
    this.currentResult.validationQuestions.forEach(q => {
      const div = document.createElement('div');
      div.className = 'validation-question-card';
      div.innerHTML = `
        <span class="badge badge-purple" style="min-width:100px; text-align:center;">${escapeHTML(q.category)}</span>
        <p style="font-size:0.85rem; font-weight:600;">${escapeHTML(q.question)}</p>
      `;
      validationBody.appendChild(div);
    });

    // 9. Render Rollout sequencing
    const renderRolloutList = (elId, phase) => {
      const el = document.getElementById(elId);
      el.innerHTML = '';
      const recs = this.currentResult.rolloutRecommendations.filter(r => r.phase === phase);
      recs.forEach(rec => {
        const li = document.createElement('li');
        li.className = 'phase-action-item';
        li.innerHTML = `
          ${escapeHTML(rec.action)}
          <span class="phase-action-owner">Owner: ${escapeHTML(rec.owner)}</span>
        `;
        el.appendChild(li);
      });
    };
    renderRolloutList('rollout-30-body', '30-day');
    renderRolloutList('rollout-60-body', '60-day');
    renderRolloutList('rollout-90-body', '90-day');

    // 10. Sync Print View
    this.syncPrintAdvisoryMemo();
  },

  renderRiskRegister() {
    const riskBody = document.getElementById('risk-cards-body');
    riskBody.innerHTML = '';

    const filterSev = document.getElementById('filter-severity').value;
    const filterCat = document.getElementById('filter-category').value;
    const filterStatus = document.getElementById('filter-status').value;

    this.currentResult.risks.forEach((risk, index) => {
      // Filters check
      if (filterSev !== 'all' && risk.severity !== filterSev) return;
      if (filterCat !== 'all' && risk.category !== filterCat) return;
      if (filterStatus !== 'all' && risk.status !== filterStatus) return;

      const card = document.createElement('div');
      card.className = `risk-card severity-${risk.severity}`;
      
      const evidenceHTML = risk.evidence.map(ev => `
        <div class="evidence-quote">
          "${escapeHTML(ev.excerpt)}" — <strong style="color:var(--text-main);">${escapeHTML(ev.sourceReference)}</strong>
        </div>
      `).join('');

      const hasValidationWarning = risk.status === 'resolved' && !window.ScoringEngine.isValidResolution(risk);

      card.innerHTML = `
        <div class="risk-card-header">
          <div class="risk-title-wrapper">
            <span class="badge ${
              risk.severity === 'critical' || risk.severity === 'high' ? 'badge-red' : 'badge-amber'
            }">${escapeHTML(risk.severity)}</span>
            <h3>${escapeHTML(risk.title)}</h3>
          </div>
          <div class="risk-meta-badges">
            <span class="badge badge-purple">${escapeHTML(risk.category)}</span>
            <span class="risk-confidence-badge">Confidence: ${(risk.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
        <div class="risk-card-body">
          <div class="risk-section-block">
            <strong>Business Impact</strong>
            <p>${escapeHTML(risk.businessImpact)}</p>
          </div>
          <div class="risk-section-block">
            <strong>Evidence</strong>
            ${evidenceHTML}
          </div>
          <div class="risk-section-block">
            <strong>Mitigation Strategy</strong>
            <p>${escapeHTML(risk.recommendedAction)}</p>
          </div>
          
          ${hasValidationWarning ? `
            <div style="color: var(--color-red); font-size:0.75rem; font-weight:700; background-color: rgba(239,68,68,0.05); padding: 0.5rem; border:1px solid var(--color-red); border-radius:4px;">
              ⚠️ Resolution Incomplete: Owner confirmation, non-empty resolution note, and resolution timestamp are required to remove penalty and gates.
            </div>
          ` : ''}
        </div>
        <div class="risk-card-footer">
          <div class="interactive-controls">
            <div class="control-item">
              <label for="status-${index}">Status</label>
              <select id="status-${index}" onchange="App.updateRiskField(${index}, 'status', this.value)">
                <option value="open" ${risk.status === 'open' ? 'selected' : ''}>Open</option>
                <option value="mitigating" ${risk.status === 'mitigating' ? 'selected' : ''}>Mitigating</option>
                <option value="resolved" ${risk.status === 'resolved' ? 'selected' : ''}>Resolved</option>
                <option value="accepted" ${risk.status === 'accepted' ? 'selected' : ''}>Accepted</option>
              </select>
            </div>
            
            <div class="control-item">
              <label for="owner-${index}">Assigned Owner</label>
              <input type="text" id="owner-${index}" value="${escapeHTML(risk.suggestedOwner)}" onchange="App.updateRiskField(${index}, 'suggestedOwner', this.value)">
              
              <label style="margin-left:0.5rem; display:flex; align-items:center; gap:0.25rem;">
                <input type="checkbox" ${risk.ownerStatus === 'confirmed' ? 'checked' : ''} onchange="App.updateRiskField(${index}, 'ownerStatus', this.checked ? 'confirmed' : 'unconfirmed')">
                Confirm
              </label>
            </div>

            <div class="control-item" style="flex: 1; min-width: 280px;">
               <label for="note-${index}">Resolution Note</label>
              <input type="text" id="note-${index}" placeholder="Enter resolution notes..." value="${escapeHTML(risk.resolutionNote || '')}" onchange="App.updateRiskField(${index}, 'resolutionNote', this.value)">
            </div>
          </div>
        </div>
      `;
      riskBody.appendChild(card);
    });
  },

  filterRiskCards() {
    this.renderRiskRegister();
  },

  updateRiskField(index, field, value) {
    if (!this.currentResult) return;
    
    const risk = this.currentResult.risks[index];
    risk[field] = value;
    
    // Auto-stamp resolvedAt timestamp if resolved
    if (field === 'status' && value === 'resolved') {
      risk.resolvedAt = new Date().toISOString();
      if (!risk.resolutionNote) {
        risk.resolutionNote = `Resolved on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`;
      }
    }

    this.recalculateReadinessScore();
    this.renderDashboard();
  },

  toggleDependencyStatus(depName) {
    if (!this.currentResult) return;
    const dep = this.currentResult.dependencies.find(d => d.name === depName);
    if (dep) {
      dep.status = dep.status === 'resolved' ? 'missing' : 'resolved';
      this.recalculateReadinessScore();
      this.renderDashboard();
    }
  },

  syncPrintAdvisoryMemo() {
    if (!this.currentResult) return;

    // Executive summary text
    document.getElementById('print-summary-text').textContent = this.currentResult.summary;

    // Top blockers list
    const printBlockerBody = document.getElementById('print-blockers-list');
    printBlockerBody.innerHTML = '';
    this.currentResult.topBlockers.forEach(b => {
      const li = document.createElement('li');
      li.textContent = b;
      printBlockerBody.appendChild(li);
    });

    // Score Penalty Table
    const printPenaltyBody = document.getElementById('print-penalty-body');
    printPenaltyBody.innerHTML = '';
    this.currentResult.computedPenalties.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHTML(p.factor)}</strong></td>
        <td>${escapeHTML(p.basePenalty)}</td>
        <td>${escapeHTML(p.status)}</td>
        <td style="color:#ef4444; font-weight:bold;">${escapeHTML(p.current)}</td>
      `;
      printPenaltyBody.appendChild(tr);
    });

    if (this.currentResult.gateAdjustment > 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong style="color:#ef4444;">Gate Cap Adjustment</strong></td>
        <td>-</td>
        <td>Blocker Capped</td>
        <td style="color:#ef4444; font-weight:bold;">-${escapeHTML(this.currentResult.gateAdjustment)}</td>
      `;
      printPenaltyBody.appendChild(tr);
    }

    // Risks Register Details
    const printRisksBody = document.getElementById('print-risks-body');
    printRisksBody.innerHTML = '';
    this.currentResult.risks.forEach(risk => {
      const div = document.createElement('div');
      div.className = 'print-risk-item';
      
      const evidenceHTML = risk.evidence.map(e => `
        <div class="print-evidence-quote">
          "${escapeHTML(e.excerpt)}" (${escapeHTML(e.sourceReference})
        </div>
      `).join('');

      div.innerHTML = `
        <div class="print-risk-title">
          <span>[${escapeHTML(risk.severity.toUpperCase())}] ${escapeHTML(risk.title)}</span>
          <span style="font-size:9pt; font-weight:normal; color:#666;">Status: ${escapeHTML(risk.status.toUpperCase())} | Category: ${escapeHTML(risk.category)}</span>
        </div>
        <div style="margin-top: 5px; font-size: 9.5pt;">
          <strong>Business Impact:</strong> ${escapeHTML(risk.businessImpact)}<br>
          <strong>Reasoning:</strong> ${escapeHTML(risk.reasoning)}<br>
          <strong>Mitigation:</strong> ${escapeHTML(risk.recommendedAction)}<br>
          <strong>Owner:</strong> ${escapeHTML(risk.suggestedOwner)} (${escapeHTML(risk.ownerStatus)})
          ${risk.resolutionNote ? `<br><strong>Resolution Note:</strong> ${escapeHTML(risk.resolutionNote)}` : ''}
          ${risk.resolvedAt ? `<br><strong>Resolved At:</strong> ${escapeHTML(risk.resolvedAt)}` : ''}
          ${evidenceHTML}
        </div>
      `;
      printRisksBody.appendChild(div);
    });

    // Decisions Required
    const printDecisionsBody = document.getElementById('print-decisions-body');
    printDecisionsBody.innerHTML = '';
    this.currentResult.decisions.forEach(dec => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHTML(dec.decision)}</strong></td>
        <td>${escapeHTML(dec.suggestedOwner)}</td>
        <td>${escapeHTML(dec.consequence)}</td>
      `;
      printDecisionsBody.appendChild(tr);
    });

    // Dependencies
    const printDepsBody = document.getElementById('print-dependencies-body');
    printDepsBody.innerHTML = '';
    this.currentResult.dependencies.forEach(d => {
      const statusColor = d.status === 'resolved' ? '#166534' : '#ef4444';
      const p = document.createElement('p');
      p.style.fontSize = '9.5pt';
      p.style.marginBottom = '5px';
      p.innerHTML = `
        <strong>[${escapeHTML(d.type.toUpperCase())}] ${escapeHTML(d.name)}</strong> - 
        <span style="color:${statusColor}; font-weight:bold;">${escapeHTML(d.status.toUpperCase())}</span>: 
        ${escapeHTML(d.description)}
      `;
      printDepsBody.appendChild(p);
    });

    // Validation Questions
    const printValBody = document.getElementById('print-validation-body');
    printValBody.innerHTML = '';
    this.currentResult.validationQuestions.forEach(q => {
      const p = document.createElement('p');
      p.style.fontSize = '9.5pt';
      p.style.marginBottom = '5px';
      p.innerHTML = `
        <strong>[${escapeHTML(q.category.toUpperCase())}]</strong> ${escapeHTML(q.question)}
      `;
      printValBody.appendChild(p);
    });

    // Rollout Recommendations
    const printRolloutBody = document.getElementById('print-rollout-body');
    printRolloutBody.innerHTML = '';
    const renderPrintPhase = (phaseLabel, phaseId) => {
      const items = this.currentResult.rolloutRecommendations.filter(r => r.phase === phaseId);
      if (items.length > 0) {
        const h4 = document.createElement('h4');
        h4.textContent = phaseLabel;
        printRolloutBody.appendChild(h4);
        items.forEach(i => {
          const p = document.createElement('p');
          p.style.fontSize = '9.5pt';
          p.style.marginBottom = '4px';
          p.style.paddingLeft = '10px';
          p.innerHTML = `
            ▪ ${escapeHTML(i.action)} (Owner: ${escapeHTML(i.owner)})
          `;
          printRolloutBody.appendChild(p);
        });
      }
    };
    renderPrintPhase('30-Day Launch Gate', '30-day');
    renderPrintPhase('60-Day Integration Gate', '60-day');
    renderPrintPhase('90-Day Stabilization Gate', '90-day');

    // Dynamic printed date sync at generation
    const today = new Date().toISOString().split('T')[0];
    const dateEl = document.getElementById('print-meta-date');
    if (dateEl) dateEl.textContent = today;
  }
};

// Start
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});
