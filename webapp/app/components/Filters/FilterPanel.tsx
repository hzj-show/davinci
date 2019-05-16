import React, { Component, ReactNode } from 'react'
import { FormComponentProps } from 'antd/lib/form/Form'
import {
  IGlobalControl,
  IGlobalControlRelatedItem,
  IGlobalControlRelatedField,
  IControlRequestParams,
  IMapItemControlRequestParams,
  OnGetControlOptions,
  OnFilterValueChange,
  IMapControlOptions,
  getVariableValue,
  getModelValue,
  getValidValue,
  getDefaultValue,
  IRenderTreeItem,
  getControlRenderTree,
  getAllChildren
} from './'
import { FilterTypes, CascadeFilterTypes, defaultFilterControlGridProps, SHOULD_LOAD_OPTIONS } from './filterTypes'
import { OperatorTypes } from 'utils/operatorTypes'
import { SQL_NUMBER_TYPES } from '../../globalConstants'
import FilterControl from './FilterControl'

import { Row, Col, Form } from 'antd'

const styles = require('./filter.less')

interface IFilterPanelProps {
  currentDashboard: any
  currentItems: any[]
  mapOptions: IMapControlOptions
  onGetOptions: OnGetControlOptions
  onChange: OnFilterValueChange
}

interface IFilterPanelStates {
  renderTree: IRenderTreeItem[],
  flatTree: {
    [key: string]: IRenderTreeItem
  },
  controlValues: {
    [key: string]: any
  }
}

export class FilterPanel extends Component<IFilterPanelProps & FormComponentProps, IFilterPanelStates> {

  public constructor (props: IFilterPanelProps & FormComponentProps) {
    super(props)
    this.state = {
      renderTree: [],
      flatTree: {},
      controlValues: {}
    }
  }

  private controlRequestParamsByItem: {
    [itemId: number]: {
      [filterKey: string]: IControlRequestParams
    }
  } = {}

  public componentWillReceiveProps (nextProps: IFilterPanelProps & FormComponentProps) {
    // const { filters } = this.props
    // if (nextProps.filters !== filters) {
    //   this.initcontrolValues(nextProps.filters)
    // }
    const { currentDashboard, currentItems } = nextProps
    if (currentDashboard !== this.props.currentDashboard || currentItems !== this.props.currentItems) {
      this.initDerivedState(currentDashboard, currentItems)
    }
  }

  private initDerivedState = (currentDashboard, currentItems) => {
    if (currentDashboard) {
      const config = JSON.parse(currentDashboard.config || '{}')
      const globalControls = config.filters || []

      const controlValues = {}

      this.controlRequestParamsByItem = {}

      const controls: IGlobalControl[] = globalControls.map((control) => {
        const { relatedItems } = control
        Object.keys(relatedItems).forEach((itemId) => {
          if (!currentItems.find((ci) => ci.id === Number(itemId))) {
            delete relatedItems[itemId]
          }
        })

        const defaultFilterValue = getDefaultValue(control)
        if (defaultFilterValue) {
          controlValues[control.key] = defaultFilterValue
          this.setControlRequestParams(control, defaultFilterValue, currentItems)
        }

        return control
      })

      const { renderTree, flatTree } = getControlRenderTree(controls)

      Object.values(flatTree).forEach((control) => {
        if (SHOULD_LOAD_OPTIONS[control.type]) {
          this.loadOptions(control, flatTree, controlValues)
        }
      })

      this.setState({
        renderTree,
        flatTree,
        controlValues
      })
    }
  }

  private setControlRequestParams = (control: IGlobalControl, val, currentItems, callback?) => {
    const { key, interactionType, relatedItems, relatedViews } = control

    currentItems.forEach((item) => {
      const { id } = item
      const relatedItem = relatedItems[id]
      if (relatedItem && relatedItem.checked) {
        const fields = relatedViews[relatedItem.viewId]
        if (callback) {
          callback(id)
        }
        if (!this.controlRequestParamsByItem[id]) {
          this.controlRequestParamsByItem[id] = {}
        }
        if (!this.controlRequestParamsByItem[id][key]) {
          this.controlRequestParamsByItem[id][key] = {
            variables: [],
            filters: []
          }
        }
        if (interactionType === 'column') {
          this.controlRequestParamsByItem[id][key].filters = getModelValue(control, fields as IGlobalControlRelatedField, val)
        } else {
          this.controlRequestParamsByItem[id][key].variables = getVariableValue(control, fields, val)
        }
      }
    })
  }

  private loadOptions = (
    renderControl: IRenderTreeItem,
    flatTree: { [key: string]: IRenderTreeItem },
    controlValues: { [key: string]: any }
  ) => {
    const { onGetOptions } = this.props
    const { key, interactionType, relatedViews, parent, options } = renderControl

    if (interactionType === 'column') {
      const parents = this.getParents(parent, flatTree)

      const requestParams = Object.entries(relatedViews).reduce((obj, [viewId, fields]) => {
        let filters = []
        let variables = []

        parents.forEach((parentControl) => {
          const parentValue = controlValues[parentControl.key]
          Object.entries(parentControl.relatedViews).forEach(([parentViewId, parentFields]) => {
            if (relatedViews[parentViewId]) {
              if (parentControl.interactionType === 'column') {
                filters = filters.concat(getModelValue(parentControl, parentFields as IGlobalControlRelatedField, parentValue))
              } else {
                variables = variables.concat(getVariableValue(parentControl, parentFields, parentValue))
              }
            }
          })
        })

        obj[viewId] = {
          columns: Array.isArray(fields) ? fields.map((f) => f.name) : [fields.name],
          filters,
          variables
        }

        return obj
      }, {})

      onGetOptions(key, interactionType, requestParams)
    } else {
      onGetOptions(key, interactionType, options)
    }
  }

  private getParents = (parentKey: string, flatTree: { [key: string]: IRenderTreeItem }): IGlobalControl[] => {
    let parents = []
    const parent = flatTree[parentKey]
    if (parent) {
      const { children, ...rest } = parent
      parents = parents
        .concat({...rest})
        .concat(this.getParents(rest.parent, flatTree))
    }
    return parents
  }

  private change = (control: IGlobalControl, val) => {
    const { currentItems } = this.props
    const { flatTree } = this.state
    const { key } = control
    const childrenKeys = getAllChildren(key, flatTree)
    const relatedItemIds = []

    const controlValues = {
      ...this.state.controlValues,
      [key]: val
    }

    this.setControlRequestParams(control, val, currentItems, (itemId) => {
      relatedItemIds.push(itemId)
    })

    const mapItemControlRequestParams: IMapItemControlRequestParams = relatedItemIds.reduce((acc, itemId) => {
      acc[itemId] = Object.values(this.controlRequestParamsByItem[itemId]).reduce((filterValue, val) => {
        filterValue.variables = filterValue.variables.concat(val.variables)
        filterValue.filters = filterValue.filters.concat(val.filters)
        return filterValue
      }, {
        variables: [],
        filters: []
      })
      return acc
    }, {})

    if (childrenKeys.length) {
      childrenKeys.forEach((childKey) => {
        const child = flatTree[childKey]
        if (SHOULD_LOAD_OPTIONS[child.type]) {
          this.loadOptions(child, flatTree, controlValues)
        }
      })
    }

    this.setState({ controlValues })
    this.props.onChange(mapItemControlRequestParams, key)
  }

  private renderFilterControls = (renderTree: IRenderTreeItem[], parents?: IGlobalControl[]) => {
    const { form, onGetOptions, mapOptions } = this.props
    const { controlValues } = this.state

    let components = []

    renderTree.forEach((control) => {
      const { key, width, children, ...rest } = control
      const parentsInfo = parents
        ? parents.reduce((values, parentControl) => {
            const parentSelectedValue = controlValues[parentControl.key]
            if (parentSelectedValue && !(Array.isArray(parentSelectedValue) && !parentSelectedValue.length)) {
              values = values.concat({
                control: parentControl,
                value: parentSelectedValue
              })
            }
            return values
          }, [])
        : null
      const controlGridProps = width
          ? {
              lg: width,
              md: width < 8 ? 12 : 24
            }
          : defaultFilterControlGridProps
      components = components.concat(
        <Col
          key={key}
          {...controlGridProps}
        >
          <FilterControl
            form={form}
            control={control}
            currentOptions={mapOptions[key] || []}
            parentsInfo={parentsInfo}
            onChange={this.change}
          />
        </Col>
      )
      if (children) {
        const controlWithOutChildren = { key, width, ...rest }
        components = components.concat(
          this.renderFilterControls(children, parents ? parents.concat(controlWithOutChildren) : [controlWithOutChildren])
        )
      }
    })
    return components
  }

  public render () {
    const { renderTree } = this.state

    return (
      <Form className={styles.filterPanel}>
        <Row gutter={8}>
          {this.renderFilterControls(renderTree)}
          {/* <Col span={4}>
            <Button type="primary" size="small" icon="search">查询</Button>
            <Button size="small" icon="reload">重置</Button>
          </Col> */}
        </Row>
      </Form>
    )
  }

}

export default Form.create<IFilterPanelProps & FormComponentProps>()(FilterPanel)
